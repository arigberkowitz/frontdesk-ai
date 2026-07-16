import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { agentRuns, clients } from "@/db/schema";
import { logger } from "@/lib/logger";

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
  copilotChats: number;
  failures: number;
}

const EMPTY_ACTIVITY: AgentActivity = {
  runs: [],
  qaGraded: 0,
  qaFlagged: 0,
  improveKept: 0,
  callsReviewed: 0,
  recoverySent: 0,
  copilotChats: 0,
  failures: 0,
};

export async function getAgentActivity(orgId: string, sinceHours = 48): Promise<AgentActivity> {
  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  let rows;
  try {
    rows = await db
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
  } catch (err) {
    // Fail-soft: a lagging migration hides the panel instead of crashing the dashboard.
    logger.warn("agent_runs.activity_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return EMPTY_ACTIVITY;
  }

  const activity: AgentActivity = {
    ...EMPTY_ACTIVITY,
    runs: rows.map((r) => ({ ...r, stats: (r.stats as Record<string, number> | null) ?? null })),
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
    } else if (r.kind === "copilot_chat") {
      activity.copilotChats += 1;
    }
  }
  // Copilot exchanges are throttle/analytics rows, not batch runs — keep them
  // out of the "runs" list the panel derives its headline lines from.
  activity.runs = activity.runs.filter((r) => r.kind !== "copilot_chat");
  return activity;
}
