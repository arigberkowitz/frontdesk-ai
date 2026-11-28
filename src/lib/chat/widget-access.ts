/**
 * Who may use a business's website chat, and from where.
 *
 * The widget runs on the business's own site inside an iframe served from our
 * domain (/widget/frame). Three layers decide whether a page can talk to it:
 *
 *  1. A per-business widget key (`fdw_…`) in the embed snippet. It's public by
 *     nature (it sits in the page source), so it is an address, not a
 *     password: it can be rotated without touching the client id, and nothing
 *     internal is exposed in the snippet.
 *  2. An allow-list of the owner's domains. The frame's own CSP sends
 *     `frame-ancestors` with exactly these origins, so a browser refuses to
 *     render the chat on anyone else's page. The chat API re-checks the
 *     embedding origin the frame reports.
 *  3. The chat API only answers same-origin requests (from our frame), so a
 *     script on a third-party page can't call it directly with the key.
 *
 * Pure functions only, so the policy is tested without a database.
 */

export const WIDGET_KEY_PREFIX = "fdw_";
const WIDGET_KEY_RE = /^fdw_[A-Za-z0-9_-]{20,64}$/;
/** Most domains an owner can list. A business with more sites than this can ask. */
export const MAX_WIDGET_DOMAINS = 10;

export interface WidgetSettings {
  /** The public embed key, or null until the owner first opens the card. */
  key: string | null;
  /** Hostnames, lowercase, no scheme ("example.com", "*.example.com"). */
  domains: string[];
}

/** Read the widget settings out of `clients.setup_flags`. Never throws. */
export function widgetSettings(setupFlags: unknown): WidgetSettings {
  const raw = (setupFlags as { chatWidget?: { key?: unknown; domains?: unknown } } | null)?.chatWidget;
  const key = typeof raw?.key === "string" && isWidgetKey(raw.key) ? raw.key : null;
  const domains = Array.isArray(raw?.domains)
    ? raw.domains.filter((d): d is string => typeof d === "string" && normalizeDomain(d) === d)
    : [];
  return { key, domains: domains.slice(0, MAX_WIDGET_DOMAINS) };
}

export function isWidgetKey(value: unknown): value is string {
  return typeof value === "string" && WIDGET_KEY_RE.test(value);
}

/** A fresh key: `fdw_` + 32 url-safe random characters (192 bits). */
export function generateWidgetKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return WIDGET_KEY_PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * What an owner typed → a hostname we can match, or null.
 *
 * Accepts "example.com", "https://www.example.com/contact", "EXAMPLE.com:443"
 * and "*.example.com". Refuses IPs, localhost, single-label names, bare
 * wildcards and anything with a path we can't make sense of: an allow-list
 * entry that matches more than the owner meant is worse than none.
 */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s || s.length > 253) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/:\d+$/, "").replace(/\.$/, "");
  let wildcard = false;
  if (s.startsWith("*.")) {
    wildcard = true;
    s = s.slice(2);
  }
  const labels = s.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l))) return null;
  // No IPv4 literals; a TLD is never all digits.
  if (/^\d+$/.test(labels[labels.length - 1]!)) return null;
  if (s === "localhost" || s.endsWith(".localhost")) return null;
  return wildcard ? `*.${s}` : s;
}

/** Parse the owner's textarea (one per line, or comma separated). */
export function parseDomainList(text: string): { domains: string[]; rejected: string[] } {
  const domains: string[] = [];
  const rejected: string[] = [];
  for (const part of text.split(/[\n,]+/)) {
    const t = part.trim();
    if (!t) continue;
    const d = normalizeDomain(t);
    if (!d) rejected.push(t.slice(0, 80));
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains, rejected };
}

/** An https origin string → its hostname, or null for anything else. */
function httpsHost(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return null;
    if (u.origin !== origin.replace(/\/$/, "")) return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when `origin` (the page embedding the widget) is on the owner's list.
 * "example.com" covers example.com and www.example.com; "*.example.com"
 * covers every subdomain but not the apex. https only. Our own app origin is
 * always allowed: it's where the owner previews the chat in the portal.
 */
export function originAllowed(origin: string | null | undefined, domains: string[], appOrigin: string): boolean {
  if (!origin) return false;
  if (origin.replace(/\/$/, "") === appOrigin.replace(/\/$/, "")) return true;
  const host = httpsHost(origin);
  if (!host) return false;
  return domains.some((d) => {
    if (d.startsWith("*.")) return host.endsWith(`.${d.slice(2)}`);
    return host === d || host === `www.${d}`;
  });
}

/** CSP `frame-ancestors` sources for the frame: our own origin plus each listed domain. */
export function frameAncestorSources(domains: string[]): string[] {
  const out = ["'self'"];
  for (const d of domains) {
    if (normalizeDomain(d) !== d) continue;
    if (d.startsWith("*.")) out.push(`https://${d}`);
    else out.push(`https://${d}`, `https://www.${d}`);
  }
  return out;
}

/** "#4f46e5" style accent, or the default. Anything else could break out of CSS. */
export function safeAccent(input: string | null | undefined, fallback = "#4f46e5"): string {
  return input && /^#[0-9a-f]{6}$/i.test(input) ? input.toLowerCase() : fallback;
}

export type WidgetLang = "en" | "es";

/** The widget's UI language: Spanish when asked for, English otherwise. */
export function widgetLang(input: unknown): WidgetLang {
  return typeof input === "string" && input.trim().toLowerCase().startsWith("es") ? "es" : "en";
}

/** The random per-page conversation id the frame sends. Only used for counting chats. */
export function safeConversationId(input: unknown): string | null {
  return typeof input === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(input) ? input : null;
}
