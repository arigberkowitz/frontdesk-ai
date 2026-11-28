/**
 * Turns a browser CSP violation report into one small, PII-free log record.
 *
 * Browsers send either the legacy `report-uri` shape
 * (`{"csp-report": {...}}`, content-type application/csp-report) or the
 * Reporting API shape (`[{type:"csp-violation", body:{...}}]`). Both are
 * accepted. Reports are attacker-controllable input, so nothing is trusted:
 * every field is clipped, URLs are cut down to origin (+ a path with ids
 * masked for our own pages) and query strings, fragments, referrers, user
 * agents and IPs are never kept.
 */

export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
  source: string;
  disposition: string;
}

const MAX_FIELD = 120;
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{16,}|\d{4,}|[A-Za-z0-9_-]{24,})$/i;

function clip(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\r\n\t]/g, " ").slice(0, MAX_FIELD) : "";
}

/** Our own page: path only, with anything id-shaped masked. */
function pagePath(v: unknown): string {
  if (typeof v !== "string") return "";
  try {
    const u = new URL(v);
    const path = u.pathname
      .split("/")
      .map((seg) => (ID_SEGMENT.test(seg) ? ":id" : seg))
      .join("/");
    return clip(path);
  } catch {
    return "";
  }
}

/** A resource URL: origin only. Keywords like "inline" / "eval" pass through. */
function origin(v: unknown): string {
  if (typeof v !== "string" || !v) return "";
  if (/^(inline|eval|wasm-eval|trusted-types-policy|trusted-types-sink|self)$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (u.protocol === "data:" || u.protocol === "blob:") return u.protocol;
    return clip(u.origin === "null" ? u.protocol : u.origin);
  } catch {
    return "";
  }
}

function toViolation(raw: unknown): CspViolation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const directive = clip(r["effective-directive"] ?? r["effectiveDirective"] ?? r["violated-directive"] ?? r["violatedDirective"]);
  if (!directive) return null;
  return {
    directive: directive.split(" ")[0],
    blocked: origin(r["blocked-uri"] ?? r["blockedURL"] ?? r["blockedURI"]),
    page: pagePath(r["document-uri"] ?? r["documentURL"] ?? r["documentURI"]),
    source: origin(r["source-file"] ?? r["sourceFile"]),
    disposition: clip(r["disposition"]) || "report",
  };
}

/** Up to 5 violations from a parsed report body; [] for anything unrecognized. */
export function parseCspReports(body: unknown): CspViolation[] {
  const items: unknown[] = [];
  if (Array.isArray(body)) {
    for (const entry of body) {
      const e = entry as { type?: unknown; body?: unknown } | null;
      if (e && e.type === "csp-violation") items.push(e.body);
    }
  } else if (body && typeof body === "object") {
    const legacy = (body as Record<string, unknown>)["csp-report"];
    if (legacy) items.push(legacy);
  }
  return items
    .slice(0, 5)
    .map(toViolation)
    .filter((v): v is CspViolation => v !== null);
}
