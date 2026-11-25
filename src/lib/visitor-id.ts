/**
 * Stable anonymous id for pricing A/B assignment.
 *
 * Set as a first-party cookie in `src/proxy.ts` so the same visitor keeps the
 * same variants across pages and return visits. The id is random and not tied
 * to an account. Missing or unusable ids fall back to the control variant in
 * the flag `decide` functions — the site never requires this cookie to render.
 */
export const VISITOR_COOKIE = "fd_visitor_id";
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Anything we would be willing to hash. Reject empty or absurdly long values. */
export function isUsableVisitorId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}

export function newVisitorId(): string {
  return crypto.randomUUID();
}

export function visitorCookieOptions(secure: boolean) {
  return {
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE,
    sameSite: "lax" as const,
    httpOnly: true,
    secure,
  };
}
