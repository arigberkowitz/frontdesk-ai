import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  calls,
  callGrades,
  clients,
  type Call,
  type CallGrade,
  type Client,
} from "@/db/schema";

/** QA-grade data access. Org-scoped: an operator only sees their own clients. */

export interface ReviewQueueItem {
  grade: CallGrade;
  call: Call;
  client: Client;
}

export async function listOpenGradesForOrg(orgId: string): Promise<ReviewQueueItem[]> {
  const rows = await db
    .select({ grade: callGrades, call: calls, client: clients })
    .from(callGrades)
    .innerJoin(calls, eq(callGrades.callId, calls.id))
    .innerJoin(clients, eq(callGrades.clientId, clients.id))
    .where(and(eq(clients.orgId, orgId), eq(callGrades.status, "open")))
    .orderBy(desc(callGrades.createdAt));
  return rows;
}

/** Grade for one call (client-scoped). Fail-soft on a lagging migration. */
export async function getGradeForCall(
  clientId: string,
  callId: string,
): Promise<CallGrade | null> {
  try {
    const row = await db.query.callGrades.findFirst({
      where: and(eq(callGrades.clientId, clientId), eq(callGrades.callId, callId)),
    });
    return row ?? null;
  } catch {
    return null;
  }
}

/** Mark a grade reviewed, verifying the grade's client belongs to the org. */
export async function markGradeReviewed(
  orgId: string,
  gradeId: string,
  reviewedBy: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: callGrades.id })
    .from(callGrades)
    .innerJoin(clients, eq(callGrades.clientId, clients.id))
    .where(and(eq(callGrades.id, gradeId), eq(clients.orgId, orgId)));
  if (!row) return false;
  await db
    .update(callGrades)
    .set({ status: "reviewed", reviewedBy, reviewedAt: new Date() })
    .where(eq(callGrades.id, gradeId));
  return true;
}
