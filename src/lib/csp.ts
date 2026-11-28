/**
 * Content-Security-Policy builder.
 *
 * Pure functions only (no server-only import, no I/O) so src/proxy.ts can call
 * them per request and the unit tests can pin the exact policy. Next 16's
 * recommended pattern: the proxy mints a fresh nonce per request, puts the
 * policy on the REQUEST headers so Next stamps the nonce on its own inline and
 * bundle scripts, and on the RESPONSE so the browser enforces/reports it.
 *
 * Script policy is nonce + 'strict-dynamic': only scripts that carry the nonce
 * (Next's bootstrap, Clerk's script tag) or that a nonced script creates (the
 * Clerk UI chunks, Vercel Analytics, Turnstile) may run. There is no
 * 'unsafe-inline' for scripts, so an injected <script> or onerror= handler is
 * inert. Host allowlists are ignored next to 'strict-dynamic' by browsers that
 * support it, so script-src carries none.
 *
 * Styles keep 'unsafe-inline': React style props, Tailwind, framer-motion,
 * sonner, recharts and Clerk's UI all write inline styles. Style injection is a
 * far smaller risk than script injection, and a style nonce would break every
 * style="" attribute.
 */

/**
 * THE SWITCH. false = send `Content-Security-Policy-Report-Only` (violations are
 * logged to /api/csp-report, nothing is blocked). true = send
 * `Content-Security-Policy` (the browser blocks violations). Flip this one
 * constant once the logs show no real violations, then merge. Not an env var.
 */
export const CSP_ENFORCE = false;

export const CSP_REPORT_PATH = "/api/csp-report";

export const CSP_HEADER_ENFORCE = "Content-Security-Policy";
export const CSP_HEADER_REPORT_ONLY = "Content-Security-Policy-Report-Only";

/** Clerk's production frontend API, used only when the publishable key can't be read. */
const CLERK_FALLBACK_HOST = "clerk.frontdeskai.company";

const HOSTNAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;

/** 128 random bits, base64. Fresh per request; never reused. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Clerk's frontend API host lives inside the publishable key:
 * `pk_live_<base64 of "clerk.example.com$">`. It's public (it ships in every
 * page), so reading it here is fine. Returns null for anything unparseable.
 */
export function clerkFrontendHost(publishableKey: string | undefined): string | null {
  if (!publishableKey) return null;
  const encoded = publishableKey.split("_")[2];
  if (!encoded) return null;
  try {
    const host = atob(encoded.replace(/-/g, "+").replace(/_/g, "/")).replace(/\$$/, "");
    return HOSTNAME.test(host) && host.includes(".") ? host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Sentry's ingest origin from the public DSN (`https://key@o1.ingest.us.sentry.io/2`). */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    return u.protocol === "https:" && HOSTNAME.test(u.hostname) ? `https://${u.host}` : null;
  } catch {
    return null;
  }
}

export interface CspOptions {
  nonce: string;
  /** `next dev`: adds 'unsafe-eval' (React debugging) and the HMR websocket. */
  isDev?: boolean;
  /** NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY. */
  clerkPublishableKey?: string;
  /** NEXT_PUBLIC_SENTRY_DSN. */
  sentryDsn?: string;
  /** Send the enforcing form. Only changes upgrade-insecure-requests. */
  enforce?: boolean;
}

export function buildCsp(opts: CspOptions): string {
  const { nonce, isDev = false, enforce = false } = opts;

  const clerkHost = clerkFrontendHost(opts.clerkPublishableKey);
  const sentry = sentryIngestOrigin(opts.sentryDsn);

  const connect = [
    "'self'",
    // Clerk: sign-in/up and session calls go to the instance's frontend API.
    `https://${clerkHost ?? CLERK_FALLBACK_HOST}`,
    "https://clerk-telemetry.com",
    "https://*.clerk-telemetry.com",
    // Clerk's bot/fraud protection probes a per-session host on several ports
    // (443, 992, 2082, 8443, 18443). Seen on Clerk's dev instance; the live
    // instance may or may not have it switched on, and this is harmless if not.
    "https://*.client.protect.clerk.com:*",
    // Browser test call, retell-client-js-sdk 3.x: the v3 "gateway" transport
    // signals over HTTPS to api.retellai.com/webrtc-proxy/{callId}. The
    // LiveKit transport (legacy startCall without a transport field) still
    // uses the Retell LiveKit cloud host.
    "https://api.retellai.com",
    "https://*.livekit.cloud",
    "wss://*.livekit.cloud",
  ];
  if (sentry) connect.push(sentry);
  if (isDev) connect.push("https://*.clerk.accounts.dev", "ws://localhost:*", "ws://127.0.0.1:*");

  const script = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (isDev) script.push("'unsafe-eval'");

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", script],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // img.clerk.com serves Clerk avatars. data:/blob: cover inline SVG and
    // client-made previews.
    ["img-src", ["'self'", "data:", "blob:", "https://img.clerk.com"]],
    // next/font self-hosts Geist, Fraunces and Sora.
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connect],
    // Clerk's bot check (Cloudflare Turnstile) renders in an iframe on sign-up.
    ["frame-src", ["https://challenges.cloudflare.com"]],
    ["worker-src", ["'self'", "blob:"]],
    ["media-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Stripe Checkout and the billing portal are reached by redirect after a
    // form post, and browsers apply form-action to that redirect target.
    ["form-action", ["'self'", "https://checkout.stripe.com", "https://billing.stripe.com"]],
    // Nothing of ours is meant to be framed. The website chat widget is a
    // script (public/widget.js) that runs inside the customer's page, not an
    // iframe of ours, so no route needs an exception.
    ["frame-ancestors", ["'none'"]],
  ];

  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  // Browsers ignore upgrade-insecure-requests in a report-only policy and log a
  // console warning about it, so it is only emitted once enforcing.
  if (enforce) parts.push("upgrade-insecure-requests");
  parts.push(`report-uri ${CSP_REPORT_PATH}`);
  return parts.join("; ");
}

export interface CspHeaders {
  nonce: string;
  /** Header name to use on both the request (for Next) and the response. */
  name: string;
  value: string;
}

/** One call per request: a fresh nonce and the matching header. */
export function cspHeadersFor(env: {
  nodeEnv?: string;
  clerkPublishableKey?: string;
  sentryDsn?: string;
  enforce?: boolean;
}): CspHeaders {
  const enforce = env.enforce ?? CSP_ENFORCE;
  const nonce = generateNonce();
  return {
    nonce,
    name: enforce ? CSP_HEADER_ENFORCE : CSP_HEADER_REPORT_ONLY,
    value: buildCsp({
      nonce,
      isDev: env.nodeEnv === "development",
      clerkPublishableKey: env.clerkPublishableKey,
      sentryDsn: env.sentryDsn,
      enforce,
    }),
  };
}
