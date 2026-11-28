import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import Retell from "retell-sdk";
import { env, integrations } from "./env";
import { toE164 } from "@/lib/format";
import { logger } from "./logger";
import { agentToolHeaders } from "./agent-tool-token";
import { agentBindings } from "./retell-outbound";
import { isElevenLabsVoice, isUsableVoice, isUsableVoiceId, voiceProviderOf } from "@/config/voice";
import {
  MULTILINGUAL_VOICE_MODEL,
  parseLanguages,
  retellLanguage,
  voiceModelFor,
  type RetellLocale,
} from "./languages";

/**
 * Single entry point for Retell (§9). The rest of the app never imports the SDK
 * directly — provisioning, voices, and webhook verification live here, and
 * provisioning is idempotent (it updates in place when stored IDs exist).
 */

export const DEFAULT_RETELL_MODEL = "gpt-4.1-mini" as const;
// Female, to match the default receptionist name "Riley" (owner audit: a man's
// voice saying "This is Riley" read as a mistake). Marissa is one of the two
// voices in RECOMMENDED_VOICES that the app already provisions with.
export const DEFAULT_VOICE_ID = "11labs-Marissa";

/**
 * Dead-air handling (butt dials, robodialers that never speak, dropped audio).
 * After this much silence from the caller, Retell ends the call instead of
 * holding the line open (its default is 10 minutes). Every second of a silent
 * call is a billed minute.
 *
 * 20s, with one "Are you still there?" at 10s. A real caller who goes quiet
 * to find a pen or an address is prompted, answers, and the clock starts over;
 * a line that says nothing for 20 seconds after being asked is not a caller.
 * Retell's floor is 10s, which is too tight for someone reading out a long
 * address. Pushed on every sync (CONVERSATION_SETTINGS), so existing agents
 * pick it up on their next publish.
 */
export const END_CALL_AFTER_SILENCE_MS = 20_000;
export const SILENCE_REMINDER_MS = 10_000;

export const AGENT_TOOL_NAMES = {
  checkAvailability: "check_availability",
  bookAppointment: "book_appointment",
  cancelAppointment: "cancel_appointment",
  takeMessage: "take_message",
  joinWaitlist: "join_waitlist",
  transferToHuman: "transfer_to_human",
  transferEmergency: "transfer_emergency",
  endCall: "end_call",
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
    // Never log any part of the EXPECTED digest — it's derived from the key.
    logger.warn("retell.verify.digest_mismatch", { gotLen: digest.length });
  }
  return ok;
}

/**
 * Build the authenticated callback URL for a custom agent tool.
 *
 * The token is PER CLIENT — HMAC(AGENT_TOOLS_SECRET, clientId) — so a token
 * copied out of one business's Retell config or an access log only works for
 * that business. It used to be the raw shared secret, which let anyone holding
 * it act as every tenant by editing `?client=`. The token alone is also no
 * longer enough: the tool routes verify Retell's request signature too.
 */
export function agentToolUrl(appUrl: string, path: string, clientId: string): string {
  const base = appUrl.replace(/\/$/, "");
  // The token travels in a header now (see agentToolHeaders) — never the URL.
  return `${base}/api/agent-tools/${path}?client=${clientId}`;
}

/**
 * How long the teammate's phone rings before we give up and hand the caller
 * back to the AI.
 *
 * This number is the whole ballgame for transfers. Mobile voicemail answers
 * somewhere around 25–30 seconds, and voicemail *answering* looks exactly like
 * a person answering: the call connects, the caller is bridged in, and they
 * spend the next thirty seconds talking to a recorded greeting. Eighteen
 * seconds is roughly four rings — long enough for someone who's near their
 * phone, short enough that we fail back BEFORE the voicemail box picks up, so
 * the AI can apologize and take a message instead.
 */
const TRANSFER_RING_MS = 18_000;

/**
 * Cold transfer, deliberately.
 *
 * We used to use `warm_transfer`, where the AI dials the teammate, speaks a
 * handoff summary, and then bridges the two legs. It is the nicer idea and it
 * does not work reliably: the bridge step fails intermittently even when a
 * human answers, and when the destination is classified as voicemail the agent
 * can go permanently silent while the caller listens to hold music. Both
 * failures are open, acknowledged bugs at Retell, and both happened on real
 * calls here — one caller was merged into a voicemail greeting, and the next
 * one got "Connecting you…", a teammate saying "Hello?", and then a dead line.
 *
 * Cold transfer is the boring path that works: dial, ring for a bounded time,
 * connect. `sip_invite` (rather than `sip_refer`) keeps Retell in the middle,
 * which is what makes the ring timeout — and therefore the fallback to taking a
 * message — possible at all.
 */
const COLD_TRANSFER = {
  type: "cold_transfer" as const,
  cold_transfer_mode: "sip_invite" as const,
  transfer_ring_duration_ms: TRANSFER_RING_MS,
} as const;

/** What the model reads at the moment it decides whether to put someone through. */
function transferToolDescription(
  handoffMode: "always" | "open_hours" | "never",
  openHoursNote?: string | null,
): string {
  const base =
    "Put the caller through to a human teammate when they ask for a person, say 'agent' or 'representative', or raise something sensitive.";
  if (handoffMode !== "open_hours") return base;
  const hours = openHoursNote?.trim();
  return (
    `${base} ONLY use this during the business's opening hours` +
    (hours ? ` (${hours})` : "") +
    ". Outside those hours nobody is there to answer — do not use this tool; take a message instead."
  );
}

/** The four custom function tools (§9.4) that POST to our agent-tool endpoints. */
export function buildAgentTools(
  appUrl: string,
  clientId: string,
  escalationNumber?: string | null,
  handoffMode: "always" | "open_hours" | "never" = "always",
  openHoursNote?: string | null,
  /** Only attach the waitlist tool when the business actually keeps one. The
   *  endpoint refuses either way, but an AI that offers a waitlist and then
   *  can't deliver one has already made a promise on the business's behalf. */
  waitlistEnabled = false,
  /** On-call number emergencies go to at ANY hour (null: urgent message instead). */
  emergencyNumber?: string | null,
  /** The owner turned on "ask price callers if we can text them" (and Pro + quote follow-up are on). */
  quoteTextConsent = false,
) {
  const transferTo = toE164(escalationNumber);
  const emergencyTo = toE164(emergencyNumber);
  const tools = [
    {
      type: "custom" as const,
      name: AGENT_TOOL_NAMES.checkAvailability,
      url: agentToolUrl(appUrl, "check-availability", clientId),
      headers: agentToolHeaders(clientId),
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
      headers: agentToolHeaders(clientId),
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
          sms_consent: {
            type: "boolean",
            description:
              "True ONLY if the caller clearly agreed to be texted the confirmation, a reminder, and a quick follow-up about this visit after you asked them in those words. Anything less than a clear yes is false. Giving you a phone number is not agreement.",
          },
          language: {
            type: "string",
            description:
              'Optional: the language the caller spoke, as a code ("en", "es", "fr"…). Their texts are sent in it.',
          },
          service_address: {
            type: "string",
            description:
              "Street address where the work is (with unit and town), when the job is at the caller's location.",
          },
          email: {
            type: "string",
            description:
              "Optional. For a video-call service: the email the caller gave for the video invite, spelled out and read back to them. Omit if they decline.",
          },
        },
        required: ["service", "datetime", "name", "phone", "sms_consent"],
      },
    },
    {
      type: "custom" as const,
      name: AGENT_TOOL_NAMES.cancelAppointment,
      url: agentToolUrl(appUrl, "cancel", clientId),
      headers: agentToolHeaders(clientId),
      description:
        "Cancel the caller's existing appointment. Confirm which appointment and get a clear yes before calling this. Only appointments booked under the number the caller is calling from can be cancelled; if theirs is under another number, take a message instead.",
      speak_during_execution: true,
      parameters: {
        type: "object" as const,
        properties: {
          phone: {
            type: "string",
            description:
              "Omit. The number the caller is calling from is used; a different number will be refused.",
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
      headers: agentToolHeaders(clientId),
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
          service_address: {
            type: "string",
            description:
              "Street address where the work is (with unit and town), when the job is at the caller's location.",
          },
          emergency: {
            type: "boolean",
            description:
              "true ONLY for a genuine emergency (flooding, burst pipe, no heat, gas smell, no power, a safety problem). The owner is texted and emailed immediately.",
          },
          ...(quoteTextConsent
            ? {
                text_consent: {
                  type: "boolean",
                  description:
                    "Only for a caller who asked about a price or quote and didn't book: true ONLY if you asked the exact quote-text question and they clearly said yes. false if they said no, hesitated, or you didn't ask.",
                },
                language: {
                  type: "string",
                  description: "Code of the language you asked in, e.g. \"en\" or \"es\".",
                },
              }
            : {}),
        },
        required: ["name", "phone"],
      },
    },
    {
      type: "custom" as const,
      name: AGENT_TOOL_NAMES.joinWaitlist,
      url: agentToolUrl(appUrl, "waitlist", clientId),
      headers: agentToolHeaders(clientId),
      description:
        "Offer this ONLY after check_availability could not give the caller a time that works for them. Ask if they'd like a text when something opens up, and call this if they say yes. Capture the RANGE of times they'd accept, not one exact time.",
      parameters: {
        type: "object" as const,
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          service: { type: "string", description: "The service they were trying to book." },
          earliest_datetime: {
            type: "string",
            description:
              "ISO 8601. The earliest time they'd take. Omit if they'd take anything from now on.",
          },
          latest_datetime: {
            type: "string",
            description:
              "ISO 8601. The latest time they'd take, e.g. the end of the week they named. Omit if they're flexible.",
          },
          note: {
            type: "string",
            description: "What they said about timing, in their own words. e.g. 'mornings only'.",
          },
        },
        required: ["name", "phone"],
      },
    },
    // E.164 or nothing. Retell rejects anything else with a 400, and because
    // this is built during provisioning, one badly-formatted escalation number
    // used to fail the ENTIRE publish — no agent, no phone binding, and an
    // error message that blamed the receptionist instead of the phone field.
    // A number we can't normalize degrades to the message-taking fallback,
    // which is a worse experience for one caller rather than a dead business.
    //
    // Anything that can actually connect a caller to a person MUST be Retell's
    // native transfer_call tool. A custom function tool cannot move a call: it
    // returns text to the model, nothing more. The old code attached one in
    // "only while you're open" mode, so the agent said "one moment while I
    // connect you" and then nothing happened for the rest of the call. A
    // transfer that silently does nothing is worse than no transfer at all,
    // so the restricted mode now uses the real tool and is held to the hours by
    // the prompt and by the tool description below.
    transferTo && handoffMode !== "never"
      ? {
          type: "transfer_call" as const,
          name: AGENT_TOOL_NAMES.transferToHuman,
          description: transferToolDescription(handoffMode, openHoursNote),
          transfer_destination: { type: "predefined" as const, number: transferTo },
          transfer_option: COLD_TRANSFER,
          speak_during_execution: true,
          execution_message_description:
            "Briefly tell the caller you're connecting them to a teammate.",
        }
      : {
          type: "custom" as const,
          name: AGENT_TOOL_NAMES.transferToHuman,
          url: agentToolUrl(appUrl, "transfer", clientId),
          headers: agentToolHeaders(clientId),
          description:
            "Ask whether this caller may be put through to a person. It will answer no — use the reply it gives you and take a message instead.",
          speak_during_execution: true,
          parameters: { type: "object" as const, properties: {}, required: [] },
        },
    ...(emergencyTo
      ? [
          {
            type: "transfer_call" as const,
            name: AGENT_TOOL_NAMES.transferEmergency,
            description:
              "Connect a caller with a genuine emergency (flooding, burst pipe, no heat, gas smell, no power, a safety problem) to the on-call person. Works at any hour, even when the business is closed. Never use it for routine requests.",
            transfer_destination: { type: "predefined" as const, number: emergencyTo },
            transfer_option: COLD_TRANSFER,
            speak_during_execution: true,
            execution_message_description:
              "Briefly tell the caller you're connecting them to the on-call person now.",
          },
        ]
      : []),
    // Without a hang-up tool the agent could only wait out the silence timer:
    // robocalls, voicemail greetings and finished callers held the line (and
    // the minutes) for another 30 seconds or more.
    {
      type: "end_call" as const,
      name: AGENT_TOOL_NAMES.endCall,
      description:
        "Hang up. Use after a short goodbye once the caller confirms they need nothing else, or right away on a robocall, a voicemail greeting, or a sales pitch to the business.",
    },
  ];
  return waitlistEnabled
    ? tools
    : tools.filter((t) => t.name !== AGENT_TOOL_NAMES.joinWaitlist);
}

export interface ProvisionAgentInput {
  clientId: string;
  agentName: string;
  generalPrompt: string;
  /** First line the agent speaks (Retell LLM begin_message). */
  beginMessage?: string | null;
  /** Human teammate's number for the transfer (Retell transfer_call tool). */
  escalationNumber?: string | null;
  /** When the agent may connect a caller to a person. */
  handoffMode?: "always" | "open_hours" | "never";
  /** Opening hours in one line, quoted in the transfer tool's description. */
  openHoursNote?: string | null;
  /** Attach the waitlist tool (see buildAgentTools). */
  waitlistEnabled?: boolean;
  /** On-call number for 24/7 emergency transfers (see emergencyTransferFor). */
  emergencyNumber?: string | null;
  /** Attach text_consent to take_message (quote-consent.ts). Must match the prompt. */
  quoteTextConsent?: boolean;
  /** Client languages setting (see lib/languages.ts). Decides the agent's speech model. */
  languages?: string | null;
  /** Business IANA timezone; sets the agent clock for {{current_time}}. */
  timezone?: string | null;
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
  /**
   * Build/update the agent but don't BUY a number when there isn't one yet
   * (the business hasn't unlocked one — see number-gate.ts). An existing number
   * is still re-bound as usual.
   */
  skipNewNumber?: boolean;
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

/**
 * The agent's speech settings for a business's languages: `language` (one
 * locale, or an explicit locale array for a multilingual agent; Retell
 * deprecated the scalar "multi") and, when it speaks anything but English, a
 * multilingual ElevenLabs voice model. Shared by provisioning and every sync.
 */
export function agentSpeechSettings(languages?: string | null): {
  language: RetellLocale | RetellLocale[];
  voice_model?: typeof MULTILINGUAL_VOICE_MODEL;
} {
  const codes = parseLanguages(languages);
  const voiceModel = voiceModelFor(codes);
  return { language: retellLanguage(codes), ...(voiceModel ? { voice_model: voiceModel } : {}) };
}

/**
 * Turn-taking and audio settings, pushed on every provision AND every sync so
 * existing agents pick them up (they used to run on Retell's defaults).
 *
 * - interruption_sensitivity 0.8: callers can cut in naturally, but a cough or
 *   a TV in the background doesn't stop the agent mid-sentence (default 1).
 * - responsiveness 1: answer as soon as the caller finishes (lowest latency).
 * - backchannel at a low frequency: the odd "mm-hm" while a caller explains a
 *   problem, which is what makes a long description feel listened to.
 * - noise cancellation: callers ring from trucks, kitchens and job sites.
 * - max_call_duration 20 min: a stuck or looping call can't burn an hour.
 * - silence: end after END_CALL_AFTER_SILENCE_MS, one reminder at
 *   SILENCE_REMINDER_MS (see those constants).
 * - timezone: the business's, so {{current_time}} and friends read local time.
 */
export const CONVERSATION_SETTINGS = {
  interruption_sensitivity: 0.8,
  responsiveness: 1,
  enable_backchannel: true,
  backchannel_frequency: 0.4,
  denoising_mode: "noise-cancellation" as const,
  max_call_duration_ms: 20 * 60_000,
  end_call_after_silence_ms: END_CALL_AFTER_SILENCE_MS,
  reminder_trigger_ms: SILENCE_REMINDER_MS,
  reminder_max_count: 1,
};

export function agentConversationSettings(timezone?: string | null): typeof CONVERSATION_SETTINGS & {
  timezone?: string;
} {
  const tz = timezone?.trim();
  let valid = false;
  if (tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      valid = true;
    } catch {
      valid = false;
    }
  }
  return { ...CONVERSATION_SETTINGS, ...(valid ? { timezone: tz } : {}) };
}

/** Create or update the Retell LLM + agent + phone number for a client (§9.1). */
export async function provisionAgentForClient(
  input: ProvisionAgentInput,
): Promise<ProvisionAgentResult> {
  const client = getRetellClient();
  const tools = buildAgentTools(
    input.appUrl,
    input.clientId,
    input.escalationNumber,
    input.handoffMode ?? "always",
    input.openHoursNote,
    input.waitlistEnabled ?? false,
    input.emergencyNumber,
    input.quoteTextConsent ?? false,
  );

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
  // A saved voice Retell won't accept on this engine (xAI speech-to-speech
  // voices) must not fail the whole provision: a new agent gets the default
  // voice, an existing one keeps whatever voice it's live on.
  const usableVoice = isUsableVoiceId(input.voiceId) ? input.voiceId!.trim() : null;
  const keepLiveVoice = Boolean(input.voiceId?.trim()) && !usableVoice;
  if (keepLiveVoice) {
    logger.warn("retell.voice.unsupported", { clientId: input.clientId, voiceId: input.voiceId });
  }
  const agentBody = {
    response_engine: { type: "retell-llm" as const, llm_id: llmId },
    voice_id: usableVoice ?? DEFAULT_VOICE_ID,
    agent_name: input.agentName,
    webhook_url: input.webhookUrl,
    boosted_keywords: input.boostedKeywords?.length ? input.boostedKeywords : null,
    // The homepage's headline claim — "switches to fluent Spanish the second a
    // caller speaks it" — was sitting above an agent hard-coded to en-US. The
    // Settings toggle changed prompt text and nothing else, so the one thing
    // that decides what the caller can actually speak never moved. Now the
    // agent gets the exact locales the business picked (Retell deprecated the
    // catch-all "multi", which meant ten languages and the least accurate
    // recognition) plus a voice model that can pronounce them.
    ...agentSpeechSettings(input.languages),
    // Includes the dead-air settings (END_CALL_AFTER_SILENCE_MS).
    ...agentConversationSettings(input.timezone),
  };
  let agentId = input.existingAgentId ?? null;
  if (agentId) {
    const { voice_id: _voice, ...withoutVoice } = agentBody;
    await client.agent.update(agentId, keepLiveVoice ? withoutVoice : agentBody);
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
    if (!phoneNumber && input.skipNewNumber) {
      // Reserved: nothing to buy yet, and nothing went wrong.
    } else if (phoneNumber) {
      await client.phoneNumber.update(phoneNumber, {
        ...agentBindings(agentId),
        inbound_webhook_url: input.webhookUrl,
      });
    } else {
      const pn = await client.phoneNumber.create({
        ...agentBindings(agentId),
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

/**
 * The agent.update payload for a voice change. Multilingual agents stay on
 * eleven_flash_v2_5 (ElevenLabs only). English-only agents send voice_model:
 * null so a leftover ElevenLabs model doesn't block Cartesia/OpenAI voices.
 *
 * Prod, 27 Nov 2026 4:54 PM PT: saving cartesia-Allie failed with
 * "400 Selected voice model eleven_flash_v2_5 is not supported for this
 * voice provider" because we only sent voice_id and left the existing model.
 */
export function agentVoiceUpdateBody(
  voiceId: string,
  languages?: string | null,
): { voice_id: string; voice_model: typeof MULTILINGUAL_VOICE_MODEL | null } {
  if (!isUsableVoiceId(voiceId)) {
    throw new Error(`Voice ${voiceId} isn't supported on this agent engine`);
  }
  const model = voiceModelFor(parseLanguages(languages));
  if (model) {
    if (!isElevenLabsVoice({ voiceId })) {
      throw new Error(`Voice ${voiceId} can't be used on a multilingual agent`);
    }
    return { voice_id: voiceId, voice_model: model };
  }
  return { voice_id: voiceId, voice_model: null };
}

/** Update the voice (and matching voice model) on a provisioned agent. */
export async function updateAgentVoice(
  agentId: string,
  voiceId: string,
  languages?: string | null,
): Promise<void> {
  const body = agentVoiceUpdateBody(voiceId, languages);
  logger.info("voice.update", {
    agentId,
    voiceId,
    provider: voiceProviderOf({ voiceId }),
    voiceModel: body.voice_model,
  });
  await getRetellClient().agent.update(agentId, body);
}

export interface RetellVoice {
  voiceId: string;
  name: string;
  provider?: string;
  gender?: string;
  accent?: string;
  previewUrl?: string;
}

const VOICES_CACHE_MS = 10 * 60_000;
let voicesCache: { at: number; voices: RetellVoice[] } | null = null;

/** List available Retell voices for the voice picker (§B3). Cached for 10 minutes. */
export async function listRetellVoices(opts?: { fresh?: boolean }): Promise<RetellVoice[]> {
  if (!opts?.fresh && voicesCache && Date.now() - voicesCache.at < VOICES_CACHE_MS) {
    return voicesCache.voices;
  }
  const client = getRetellClient();
  const voices = await client.voice.list();
  // Hide voices our agents can't speak with (see isUsableVoice). Language
  // filtering happens in voicesForAgent, which also merges curated defaults.
  const mapped = voices
    .filter((v) => isUsableVoice({ voiceId: v.voice_id, provider: v.provider }))
    .map((v) => ({
      voiceId: v.voice_id,
      name: v.voice_name,
      provider: v.provider,
      gender: v.gender ?? undefined,
      accent: v.accent ?? undefined,
      previewUrl: v.preview_audio_url ?? undefined,
    }));
  voicesCache = { at: Date.now(), voices: mapped };
  return mapped;
}

/** @internal test hook */
export function _clearRetellVoicesCache(): void {
  voicesCache = null;
}

/**
 * Connection details the browser SDK needs to join a test call.
 * accessToken and iceServers are short-lived per-call credentials — return
 * them to the signed-in owner, never log them.
 */
export type WebCallConnection = {
  callId: string;
  accessToken: string;
  transport: "gateway" | "livekit";
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
};

/**
 * Create a browser test call via Retell's v3 API.
 *
 * Prod, 27 Nov 2026 4:55 PM PT: the SDK 5.36 helper still posted to
 * /v2/create-web-call, which Retell now rejects:
 * "400 Deprecated API usage is no longer supported: Create Web Call v2."
 * We call /v3/create-web-call directly so we don't have to take a major
 * retell-sdk bump (6.0 removed other endpoints) to fix sign-up test calls.
 * Ref: https://docs.retellai.com/deprecation-notice/2026/09-30_create_web_call_v2
 */
export async function createWebCall(agentId: string): Promise<WebCallConnection> {
  if (!integrations.retell()) {
    throw new Error("RETELL_API_KEY is not set — Retell features are unavailable.");
  }
  const res = await fetch("https://api.retellai.com/v3/create-web-call", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RETELL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ agent_id: agentId }),
  });
  if (!res.ok) {
    let detail = `Retell create web call failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string" && body.message.trim()) {
        detail = `${res.status} ${body.message}`;
      }
    } catch {
      // Keep the status-only message. Don't read the raw body into logs later.
    }
    throw new Error(detail);
  }
  const data = (await res.json()) as {
    call_id?: unknown;
    access_token?: unknown;
    transport?: unknown;
    ice_servers?: unknown;
  };
  if (typeof data.call_id !== "string" || !data.call_id || typeof data.access_token !== "string" || !data.access_token) {
    throw new Error("Retell create web call returned an incomplete response");
  }
  const iceServers = Array.isArray(data.ice_servers)
    ? data.ice_servers.filter((s): s is WebCallConnection["iceServers"][number] => {
        if (!s || typeof s !== "object") return false;
        const urls = (s as { urls?: unknown }).urls;
        return typeof urls === "string" || (Array.isArray(urls) && urls.every((u) => typeof u === "string"));
      })
    : [];
  return {
    callId: data.call_id,
    accessToken: data.access_token,
    transport: data.transport === "livekit" ? "livekit" : "gateway",
    iceServers,
  };
}
