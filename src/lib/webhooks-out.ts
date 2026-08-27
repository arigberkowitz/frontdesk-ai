import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Outbound webhooks: the missing half of the integration story.
 *
 * Everything in `api/webhooks/` points inward — Twilio, Stripe and Retell
 * telling us things. Nothing pointed out, which meant a business whose CRM is
 * where its work actually happens had to retype every lead this thing captured.
 * The category's loudest complaint is exactly that: an AI receptionist that
 * doesn't write into the CRM has relocated the data-entry problem, not solved
 * it, and the re-entry labour routinely costs more than the subscription.
 *
 * Three events cover the asks: a call finished, a lead came in, an appointment
 * got booked. Deliberately generic and deliberately few — one webhook plus a
 * Zapier app reaches a thousand CRMs, where a native ServiceTitan connector
 * reaches one, and we don't yet know which one anybody wants.
 */

export type OutboundEvent = "call.completed" | "lead.created" | "appointment.booked";

export const OUTBOUND_EVENTS: readonly OutboundEvent[] = [
  "call.completed",
  "lead.created",
  "appointment.booked",
];

/** Wire format. `id` is stable per delivery so receivers can dedupe on retry. */
export interface WebhookPayload {
  id: string;
  event: OutboundEvent;
  createdAt: string;
  clientId: string;
  data: Record<string, unknown>;
}

const TIMEOUT_MS = 5_000;
const ATTEMPTS = 3;

/** A fresh signing secret, shown to the customer once and stored alongside the URL. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/**
 * Stripe-shaped signature: `t=<unix>,v1=<hex hmac of "t.body">`.
 *
 * The timestamp is inside the signed string, not beside it, so a captured
 * delivery can't be replayed a week later with the clock rewritten — the
 * receiver rejects anything whose `t` has drifted and the signature covers `t`,
 * so drifting it invalidates the whole thing.
 */
export function signatureHeader(secret: string, body: string, timestampSec: number): string {
  const mac = createHmac("sha256", secret).update(`${timestampSec}.${body}`).digest("hex");
  return `t=${timestampSec},v1=${mac}`;
}

/** Verify a header we produced. Exported so the receiving end can be tested. */
export function verifySignature(secret: string, body: string, header: string): boolean {
  const t = /t=(\d+)/.exec(header)?.[1];
  const v1 = /v1=([a-f0-9]+)/.exec(header)?.[1];
  if (!t || !v1) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Is this a URL we're willing to have our own server call?
 *
 * A customer types this into a settings box and our infrastructure then makes
 * a request to it — which is a server-side request forgery primitive handed to
 * anyone with an account. Plaintext http is refused because these payloads
 * carry customer names and phone numbers. Loopback, link-local and RFC1918
 * addresses are refused because on a cloud host those point at the metadata
 * service and at whatever else shares the network, not at the customer's CRM.
 *
 * This is a hostname check, so it does not stop a public DNS name that resolves
 * to a private address. Closing that hole properly means resolving and pinning
 * the IP at connect time; this rejects the accidents and the lazy attempts, and
 * the honest note is that it is a fence, not a wall.
 */
export function isDeliverableUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return false;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 169 && b === 254) return false; // cloud metadata
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  return true;
}

/** Per-client delivery config, as stored in `setupFlags`. */
export interface WebhookConfig {
  url?: string;
  secret?: string;
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  attempts: number;
  error?: string;
}

/**
 * Deliver one payload, retrying a couple of times on network trouble and 5xx.
 *
 * Never throws. Every caller is either inside a live phone call or inside a
 * webhook we must acknowledge quickly, and neither can be allowed to fail
 * because somebody's CRM is having an afternoon. A 4xx is not retried — the
 * receiver understood us and said no, and hammering it changes nothing.
 */
export async function deliver(
  config: WebhookConfig,
  payload: WebhookPayload,
  fetchImpl: typeof fetch = fetch,
  nowSec: () => number = () => Math.floor(Date.now() / 1000),
): Promise<DeliveryResult> {
  if (!config.url || !config.secret) return { ok: false, attempts: 0, error: "not configured" };
  if (!isDeliverableUrl(config.url)) return { ok: false, attempts: 0, error: "url not allowed" };

  const body = JSON.stringify(payload);
  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "FrontDeskAI-Webhooks/1",
          "x-frontdesk-event": payload.event,
          "x-frontdesk-delivery": payload.id,
          "x-frontdesk-signature": signatureHeader(config.secret, body, nowSec()),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = res.status;
      if (res.ok) return { ok: true, status: res.status, attempts: attempt };
      // Understood and refused. Retrying an authoritative no is just noise.
      if (res.status < 500) {
        return { ok: false, status: res.status, attempts: attempt, error: `HTTP ${res.status}` };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (attempt < ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
    }
  }
  return { ok: false, status: lastStatus, attempts: ATTEMPTS, error: lastError };
}
