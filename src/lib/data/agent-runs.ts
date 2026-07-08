import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, clients } from "@/db/schema";

/** Agent-run activity for the operator's "while you were out" report. */

export interface AgentRunRow {
  id: string;
  kind: string;
  status: string;
  stats: Record<string, number> | null;
  clientName: string;
  startedAt: Date;
}

export interface AgentActivity {
  runs: AgentRunRow[];
  qaGraded: number;
  qaFlagged: number;
  improveKept: number;
  callsReviewed: number;
  recoverySent: number;
  failures: number;
}

export async function getAgentActivity(orgId: string, sinceHours = 48): Promise<AgentActivity> {
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const rows = await db
    .select({
      id: agentRuns.id,
      kind: agentRuns.kind,
      status: agentRuns.status,
      stats: agentRuns.stats,
      clientName: clients.name,
      startedAt: agentRuns.startedAt,
    })
    .from(agentRuns)
    .innerJoin(clients, eq(agentRuns.clientId, clients.id))
    .where(and(eq(clients.orgId, orgId), gte(agentRuns.startedAt, since)))
    .orderBy(desc(agentRuns.startedAt))
    .limit(100);

  const activity: AgentActivity = {
    runs: rows.map((r) => ({ ...r, stats: (r.stats as Record<string, number> | null) ?? null })),
    qaGraded: 0,
    qaFlagged: 0,
    improveKept: 0,
    callsReviewed: 0,
    recoverySent: 0,
    failures: 0,
  };

  for (const r of activity.runs) {
    if (r.status === "failed") activity.failures += 1;
    const s = r.stats ?? {};
    if (r.kind === "qa_review") {
      activity.qaGraded += s.graded ?? 0;
      activity.qaFlagged += s.flagged ?? 0;
    } else if (r.kind === "nightly_improve") {
      activity.improveKept += s.kept ?? 0;
      activity.callsReviewed += s.callsReviewed ?? 0;
    } else if (r.kind === "outbound_recovery") {
      activity.recoverySent += s.sent ?? 0;
    }
  }
  return activity;
}
