import "server-only";

/**
 * Best-effort throttle for guess-able secrets entered by hand: the staff edit
 * code and the trial access code. Both are short, human-typed strings compared
 * against a stored value, and without a limiter a signed-in user can simply
 * loop the server action until one lands.
 *
 * Deliberately in-memory and dependency-free. On serverless this counts per
 * warm instance, so a determined attacker spread across cold starts sees a
 * weaker limit than the numbers below suggest — it raises the cost of casual
 * brute force by orders of magnitude without adding a table or a Redis
 * dependency, and it is not a substitute for a shared store if these codes ever
 * guard something higher-value than "edit your own business".
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Keep the map from growing without bound on a long-lived instance. */
function sweep(now: number): void {
  if (buckets.size < 500) return;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export interface RateLimitResult {
  ok: boolean;
  /** Whole seconds until the window resets (0 when allowed). */
  retryAfterSec: number;
}

/**
 * Consume one attempt for `key`. Returns ok:false once `limit` attempts have
 * been made inside `windowMs`.
 */
export function consumeAttempt(key: string, limit = 5, windowMs = 10 * 60_000): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (existing.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }
  existing.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

/** Wipe the counter after a genuine success so honest typos don't accumulate. */
export function clearAttempts(key: string): void {
  buckets.delete(key);
}

/** "in 3 minutes" / "in 45 seconds" — for a message shown to a real person. */
export function formatRetryAfter(sec: number): string {
  if (sec >= 60) {
    const mins = Math.ceil(sec / 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${Math.max(sec, 1)} second${sec === 1 ? "" : "s"}`;
}
