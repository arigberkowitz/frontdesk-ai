/**
 * Which paths the Clerk gate in src/proxy.ts protects.
 *
 * The gate used to be allow-list only: anything not explicitly public was sent
 * to /sign-in. That included URLs that don't exist, so a typo or a stale link
 * redirected to a login screen instead of our 404 page — confusing for people,
 * and a soft-404 for search engines. It also hid metadata routes (share image,
 * icons) that were never added to the list.
 *
 * Now the app's own areas are protected by prefix, and everything else that
 * isn't an app area is public — which, for a path with no page, means Next
 * renders `not-found.tsx`. Every page and server action ALSO checks auth
 * itself (auth-guard.ts); this gate is the first line, not the only one.
 *
 * Pure data so it can be tested against the real `src/app` tree: the test
 * fails if a new top-level app route appears without being classified here.
 */

/** App areas that require a signed-in session (plus every /api route not made public in proxy.ts). */
export const PROTECTED_ROUTE_PATTERNS = [
  "/dashboard(.*)",
  "/clients(.*)",
  "/review(.*)",
  "/growth(.*)",
  "/demo(.*)",
  "/settings(.*)",
  "/platform(.*)",
  "/exit-preview(.*)",
  "/portal(.*)",
  "/welcome(.*)",
  "/api(.*)",
] as const;

/** Top-level route segments that are public on purpose (see isPublicRoute in proxy.ts). */
export const PUBLIC_TOP_LEVEL_SEGMENTS = [
  "sign-in",
  "sign-up",
  "intake",
  "contact",
  "privacy",
  "sms-consent",
  "terms",
] as const;

/**
 * Plain-string mirror of Clerk's matcher for these patterns: `"/demo(.*)"`
 * matches anything that STARTS with "/demo" (so "/demos" too). Over-matching a
 * look-alike only means a sign-in redirect — the old behavior — never exposure.
 */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_ROUTE_PATTERNS.some((p) => pathname.startsWith(p.replace("(.*)", "")));
}
