import "server-only";

/**
 * Map over items with bounded concurrency — the batch loops' throughput fix.
 * Sequential loops meant "minutes per client × clients" wall-clock; this keeps
 * `limit` clients in flight while preserving result order. No dependency
 * needed for something this small.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Time budget helper: true once fewer than `reserveMs` remain before `deadline`. */
export function outOfBudget(deadline: number, reserveMs = 5_000): boolean {
  return Date.now() > deadline - reserveMs;
}

/**
 * Resumability: clients whose batch run of `kind` already succeeded in the
 * last `hours`. A truncated or re-triggered cron picks up where it left off
 * instead of re-burning tokens on clients it already served — which also lets
 * short function budgets (Vercel Hobby's 60s) converge over retries.
 */
export async function clientsAlreadyRun(
  clientIds: string[],
  kind: "nightly_improve" | "qa_review" | "outbound_recovery",
  hours = 20,
): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set();
  const { db } = await import("@/db");
  const { agentRuns } = await import("@/db/schema");
  const { and, eq, gte, inArray } = await import("drizzle-orm");
  const rows = await db
    .select({ clientId: agentRuns.clientId })
    .from(agentRuns)
    .where(
      and(
        inArray(agentRuns.clientId, clientIds),
        eq(agentRuns.kind, kind),
        eq(agentRuns.status, "succeeded"),
        gte(agentRuns.startedAt, new Date(Date.now() - hours * 3600 * 1000)),
      ),
    );
  return new Set(rows.map((r) => r.clientId));
}
