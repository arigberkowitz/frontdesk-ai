import { PROTECTED_ROUTE_PATTERNS } from "@/lib/route-access";

/**
 * Which pages are light only.
 *
 * Every signed-in app area (the customer portal, the operator app at
 * /dashboard, /clients, /review…, onboarding) wears the light "Signal" skin,
 * which has no dark variant. So those routes force the light theme whatever
 * the visitor picked before or their OS prefers — including an operator who
 * still has "dark" saved from the old top-bar toggle. Marketing and legal pages
 * keep their existing behavior.
 *
 * Derived from the same prefix list the auth gate uses, so a new app area is
 * light-only the moment it's protected. `/api` is skipped (no pages there).
 */
const LIGHT_ONLY_PREFIXES = PROTECTED_ROUTE_PATTERNS.map((p) => p.replace("(.*)", "")).filter(
  (p) => p !== "/api",
);

export function isLightOnlyPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return LIGHT_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
