import "server-only";
import { checkRateLimit } from "@vercel/firewall";
import { logger } from "@/lib/logger";

/**
 * Rate-limit IDs for `@vercel/firewall` `checkRateLimit`.
 *
 * Each ID is a no-op until a matching Vercel Firewall rule is published:
 *   If: @vercel/firewall, Rate limit ID = this string
 *   Then: Rate Limit (fixed window)
 *
 * Until that rule exists, the SDK returns `not-found` and we fail open —
 * existing in-memory / Postgres caps still apply. Do not create or publish
 * dashboard rules without explicit approval. Exact proposed rules, limits,
 * and what must be approved: docs/waf-rate-limits.md.
 *
 * `vercel.json` cannot express a `rate_limit` action (only deny/challenge),
 * so the reviewable code path is this helper plus those dashboard rules.
 */
export const WAF_RATE_LIMIT_IDS = {
  /** POST /api/chat — public website receptionist (LLM + tools). */
  chat: "public-chat",
  /** Public /contact form (email to the operator). */
  contact: "public-contact",
  /** Public /intake/[token] form (can trigger a paid website scrape). */
  intake: "public-intake",
  /** Signed-in browser test call: POST /api/clients/:id/test-call (Retell). */
  testCall: "owner-test-call",
  /** Signed-in "call me now" (Retell outbound to a real phone). */
  callMe: "owner-call-me",
  /** Self-serve /welcome setup (website scrape + provision). */
  signupOnboard: "signup-onboard",
} as const;

const CHECK_TIMEOUT_MS = 800;

export interface WafRateLimitOptions {
  request?: Request;
  headers?: Headers;
  /** Overrides the default client-IP bucket. */
  rateLimitKey?: string;
}

/**
 * True when a published WAF rule says this caller is over the limit.
 * False when the request is allowed, the rule is missing, we're not in
 * production, or the check itself fails. Never fail closed.
 */
export async function wafRateLimited(
  rateLimitId: string,
  options: WafRateLimitOptions = {},
): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return false;

  try {
    const { rateLimited, error } = await checkRateLimit(rateLimitId, {
      request: options.request,
      headers: options.headers,
      rateLimitKey: options.rateLimitKey,
      timeout: CHECK_TIMEOUT_MS,
    });
    if (error === "not-found") {
      logger.warn("waf.rate_limit.rule_missing", { rateLimitId });
    }
    return rateLimited;
  } catch (err) {
    logger.warn("waf.rate_limit.check_failed", {
      rateLimitId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
