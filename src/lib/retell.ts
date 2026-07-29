import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import Retell from "retell-sdk";
import { env, integrations } from "./env";
import { logger } from "./logger";

/**
 * Single entry point for Retell (§9). The rest of the app never imports the SDK
 * directly — provisioning, voices, and webhook verification live here, and
 * provisioning is idempotent (it updates in place when stored IDs exist).
 */

export const DEFAULT_RETELL_MODEL = "gpt-4.1-mini" as const;
export const DEFAULT_VOICE_ID = "11labs-Adrian";

/**
 * Dead-air handling (butt dials, fake numbers, dropped audio). After this much
 * silence following agent speech, Retell ends the call instead of holding the
 * line open (its default is 10 minutes). We nudge the caller once partway
 * through so a real caller who simply paused isn't hung up on.
 */
export const END_CALL_AFTER_SILENCE_MS = 30_000; // ~30s of silence → hang up
export const SILENCE_REMINDER_MS = 15_000; // "Are you still there?" at ~15s

export const AGENT_TOOL_NAMES = {
  checkAvailability: "check_availability",
  bookAppointment: "book_appointment",
  cancelAppointment: "cancel_appointment",
  takeMessage: "take_message",
  transferToHuman: "transfer_to_human",
} as const;

let _client: Retell | null = null;

export function getRetellClient(): Retell {
  if (!integrations.retell()) {
    throw new Error("RETELL_API_KEY is not set — Retell features are unavailable.");
  }
  _client ??= new Retell({ apiKey: env.RETELL_API_KEY });
  return _client;
}

/**
 * Verify the `x-retell-signature` header on an inbound webhook (§9.2, §12).
 *
 * Retell signs Stripe-style: the header is `v=<unixMillis>,d=<hexDigest>`, where
 * the digest is HMAC-SHA256 of `rawBody + timestamp` keyed by the API key (the
 * key carrying the "webhook" badge in the Retell dashboard). The raw body must be
 * used verbatim — a re-serialized JSON will not match. Timestamps older than
 * 5 minutes are rejected for replay protection. retell-sdk 5.x ships no verify
 * helper, so we implement the documented scheme here.
 * Ref: https://docs.retellai.com/features/secure-webhook
 */
const RETELL_SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export function verifyRetellSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
): boolean {
  if (!env.RETELL_API_KEY) {
    logger.warn("retell.verify.no_api_key");
    return false;
  }
  if (!signatureHeader) {
    logger.warn("retell.verify.no_signature_header");
    return false;
  }
  const match = /^v=(\d+),d=(.+)$/.exec(signatureHeader.trim());
  if (!match) {
    logger.warn("retell.verify.bad_header_format", { sample: signatureHeader.slice(0, 32) });
    return false;
  }
  const [, timestamp, digest] = match;
  const skewMs = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(skewMs) || skewMs > RETELL_SIGNATURE_TOLERANCE_MS) {
    logger.warn("retell.verify.stale_timestamp", { skewMs });
    return false;
  }
  const expected = createHmac("sha256", env.RETELL_API_KEY)
    .update(rawBody + timestamp, "utf8")
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(digest);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    logger.warn("retell.verify.digest_mismatch", {
      gotPrefix: digest.slice(0, 10),
      expectedPrefix: expected.slice(0, 10),
      gotLen: digest.length,
    });
  }
  return ok;
}

/** Build the authenticated callback URL for a custom agent tool. */
function agentToolUrl(appUrl: string, path: string, clientId: string): string {
  const base = appUrl.replace(/\/$/, "");
  return `${base}/api/agent-tools/${path}?client=${clientId}&token=${encodeURIComponent(env.AGENT_TOOLS_SECRET)}`;
}

/** The four custom function tools (§9.4) that POST to our agent-tool endpoints. */
export function buildAgentTools(appUrl: string, clientId: string, escalationNumber?: string | null) {
  return [
    {
      type: "custom" as const,
      name: AGENT_TOOL_NAMES.checkAvailability,
      url: agentToolUrl(appUrl, "check-availability", clientId),
      description:
        "Check open appointment slots for a service over a date range. Call this before booking.",
      speak_during_execution: true,
      parameters: {
        type: "object" as const,
        properties: {
          service: { type: "string", description: "The service the caller wants to book." },
          date_range: {
            type: "string",
            description: "Natural-language date or range, e.g. 'next Tuesday' or 'this week'.",
          },
        },
        required: ["service"],
      },
    },
    {
      type: "custom" as const,
      name: AGENT_TOOL_NAMES.bookAppointment,
      url: agentToolUrl(appUrl, "book", clientId),
      description: "Book an appointment after confirming service, date/time, name, and phone.",
      speak_during_execution: true,
      parameters: {
        type: "object" as const,
        properties: {
          service: { type: "string" },
          datetime: { type: "string", description: "ISO 8601 start date-time." },
          name: { type: "string" },
          phone: { type: "string" },
          person: {
            type: "string",
            description:
              "Optional: the staff member the caller asked for by name. Omit if they have no preference.",
          },
        },
        required: ["service", "datetime", "name", "phone"],
      },
    },
    {
      type: "custom" as const,
      name: AGENT_TOOL_NAMES.cancelAppointment,
      url: agentToolUrl(appUrl, "cancel", clientId),
      description:
        "Cancel the caller's existing appointment. Confirm which appointment and get a clear yes before calling this. Looks the booking up by phone number (defaults to the caller's number).",
      speak_during_execution: true,
      parameters: {
        type: "object" as const,
        properties: {
          phone: {
            type: "string",
            description:
              "The phone number the appointment was booked under. Omit to use the number the caller is calling from.",
          },
          datetime: {
            type: "string",
            description:
              "ISO 8601 start date-time of the appointment to cancel — only needed when the caller has more than one upcoming appointment.",
          },
        },
        required: [],
      },
    },
    {
      type: "custom" as const,
      name: AGENT_TOOL_NAMES.takeMessage,
      url: agentToolUrl(appUrl, "message", clientId),
      description:
        "Capture a message/lead when booking isn't possible. Get name and phone, and when it comes up naturally also capture what they need (service), how soon (urgency), and any budget they mention — it helps the team prioritize the callback.",
      parameters: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          reason: { type: "string" },
          message: { type: "string" },
          service: { type: "string", description: "What the caller wants/needs." },
          urgency: { type: "string", description: "How soon they need it, e.g. 'ASAP', 'this week'." },
          budget: { type: "string", description: "Any budget the caller mentioned." },
        },
        required: ["name", "phone"],
      },
    },
    escalationNumber?.trim()
      ? {
          type: "transfer_call" as const,
          name: AGENT_TOOL_NAMES.transferToHuman,
          description:
            "Warm-transfer the caller to a human teammate when they ask for a person, say 'agent'/'representative', or for sensitive matters.",
          transfer_destination: { type: "predefined" as const, number: escalationNumber.trim() },
          transfer_option: { type: "warm_transfer" as const, agent_detection_timeout_ms: 20000 },
          speak_during_execution: true,
          execution_message_description: "Briefly tell the caller you're connecting them to a teammate.",
        }
      : {
          type: "custom" as const,
          name: AGENT_TOOL_NAMES.transferToHuman,
          url: agentToolUrl(appUrl, "transfer", clientId),
          description: "Transfer the call to a human when requested or for sensitive matters.",
          speak_during_execution: true,
          parameters: { type: "object" as const, properties: {}, required: [] },
        },
  ];
}

export interface ProvisionAgentInput {
  clientId: string;
  agentName: string;
  generalPrompt: string;
  /** First line the agent speaks (Retell LLM begin_message). */
  beginMessage?: string | null;
  /** Human teammate's number for warm-transfer (Retell transfer_call tool). */
  escalationNumber?: string | null;
  voiceId?: string | null;
  boostedKeywords?: string[];
  /** Base app URL for webhook + tool callbacks (e.g. a tunnel URL in dev). */
  appUrl: string;
  webhookUrl: string;
  areaCode?: number;
  model?: string;
  existingLlmId?: string | null;
  existingAgentId?: string | null;
  existingPhoneNumber?: string | null;
}

export interface ProvisionAgentResult {
  llmId: string;
  agentId: string;
  /** null when a number couldn't be provisioned (e.g. no card on file) — the LLM +
   *  agent are still saved so the browser test call keeps working. */
  phoneNumber: string | null;
  /** Friendly reason a number wasn't provisioned (shown to the operator), else null. */
  phoneError?: string | null;
}

/** Create or update the Retell LLM + agent + phone number for a client (§9.1). */
export async function provisionAgentForClient(
  input: ProvisionAgentInput,
): Promise<ProvisionAgentResult> {
  const client = getRetellClient();
  const tools = buildAgentTools(input.appUrl, input.clientId, input.escalationNumber);

  // 1. LLM — create or update by stored id.
  let llmId = input.existingLlmId ?? null;
  if (llmId) {
    await client.llm.update(llmId, {
      general_prompt: input.generalPrompt,
      general_tools: tools,
      begin_message: input.beginMessage ?? null,
    });
  } else {
    const llm = await client.llm.create({
      model: (input.model ?? DEFAULT_RETELL_MODEL) as Retell.LlmCreateParams["model"],
      general_prompt: input.generalPrompt,
      general_tools: tools,
      begin_message: input.beginMessage ?? null,
    });
    llmId = llm.llm_id;
  }

  // 2. Agent — bind the LLM, voice, webhook, keywords.
  const agentBody = {
    response_engine: { type: "retell-llm" as const, llm_id: llmId },
    voice_id: input.voiceId || DEFAULT_VOICE_ID,
    agent_name: input.agentName,
    webhook_url: input.webhookUrl,
    boosted_keywords: input.boostedKeywords?.length ? input.boostedKeywords : null,
    language: "en-US" as const,
    // End dead-air calls (butt dials / fake numbers) instead of holding the line
    // open for 10 minutes, with one reminder so real callers who paused aren't cut off.
    end_call_after_silence_ms: END_CALL_AFTER_SILENCE_MS,
    reminder_trigger_ms: SILENCE_REMINDER_MS,
    reminder_max_count: 1,
  };
  let agentId = input.existingAgentId ?? null;
  if (agentId) {
    await client.agent.update(agentId, agentBody);
  } else {
    const agent = await client.agent.create(agentBody);
    agentId = agent.agent_id;
  }

  // 3. Phone number — provision new or re-bind existing. A missing card (402) or
  //    any failure must NOT orphan the LLM + agent we just created/updated, so we
  //    swallow it and return a null number (the browser test call still works).
  let phoneNumber = input.existingPhoneNumber ?? null;
  let phoneError: string | null = null;
  try {
    if (phoneNumber) {
      await client.phoneNumber.update(phoneNumber, {
        inbound_agents: [{ agent_id: agentId, weight: 1 }],
        inbound_webhook_url: input.webhookUrl,
      });
    } else {
      const pn = await client.phoneNumber.create({
        inbound_agents: [{ agent_id: agentId, weight: 1 }],
        inbound_webhook_url: input.webhookUrl,
        area_code: input.areaCode,
        nickname: `${input.agentName} (${input.clientId.slice(0, 8)})`,
      });
      phoneNumber = pn.phone_number;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("retell.phone.provision_failed", { clientId: input.clientId, error: msg });
    phoneNumber = null;
    // Most common cause is no payment method on the Retell account (402).
    phoneError = /402|payment|card|billing/i.test(msg)
      ? "Add a payment method in Retell to get a phone number — the AI works for browser test calls until then."
      : "Couldn't get a phone number from Retell just now — the AI still works for browser test calls.";
  }

  return { llmId, agentId, phoneNumber, phoneError };
}

/** Update just the voice on a provisioned agent (the per-business voice picker). */
export async function updateAgentVoice(agentId: string, voiceId: string): Promise<void> {
  await getRetellClient().agent.update(agentId, { voice_id: voiceId });
}

export interface RetellVoice {
  voiceId: string;
  name: string;
  provider?: string;
  gender?: string;
  accent?: string;
}

/** List available Retell voices for the voice picker (§B3). */
export async function listRetellVoices(): Promise<RetellVoice[]> {
  const client = getRetellClient();
  const voices = await client.voice.list();
  return voices.map((v) => ({
    voiceId: v.voice_id,
    name: v.voice_name,
    provider: v.provider,
    gender: v.gender ?? undefined,
    accent: v.accent ?? undefined,
  }));
}
