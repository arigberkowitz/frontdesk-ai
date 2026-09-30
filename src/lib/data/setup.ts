import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertContacts, businessHours, calls, clients, knowledgeItems, services } from "@/db/schema";
import { getBookingProviderForClient } from "@/lib/booking";
import { formatPhone } from "@/lib/format";
import { buildSetupSteps, type SetupStep } from "@/lib/setup-steps";

export type { SetupStep } from "@/lib/setup-steps";

export interface SetupStatus {
  steps: SetupStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  /** Owner clicked "I'm done" and the AI readiness check passed. */
  finishedAt: Date | null;
  /** Advisory notes from the AI review. Optional improvements, never blockers. */
  reviewNotes: string[];
  /** Owner hid the unfinished checklist from the Overview ("Hide for now"). */
  hiddenAt: string | null;
}

/** Activation checklist state for a client, derived from real data. `complete`
 *  lets the portal hide the card once everything's set up. */
export async function getClientSetupStatus(clientId: string): Promise<SetupStatus> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  const [svc] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(services)
    .where(and(eq(services.clientId, clientId), isNull(services.deletedAt)));
  const [kb] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.clientId, clientId), isNull(knowledgeItems.deletedAt)));
  const [hrs] = await db
    .select({
      n: sql<number>`count(*) filter (where ${businessHours.isClosed} = false and ${businessHours.openTime} is not null)::int`,
    })
    .from(businessHours)
    .where(eq(businessHours.clientId, clientId));
  const [alerts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(alertContacts)
    .where(eq(alertContacts.clientId, clientId));
  const [callCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(calls)
    .where(eq(calls.clientId, clientId));

  const calendar = client ? getBookingProviderForClient(client).isConfigured() : false;
  const flags = client?.setupFlags ?? {};
  const aiNumber = client?.retellPhoneNumber ? formatPhone(client.retellPhoneNumber) : null;

  const steps = buildSetupSteps({
    services: svc?.n ?? 0,
    openDays: hrs?.n ?? 0,
    faqs: kb?.n ?? 0,
    greeting: client?.greeting,
    calendarConnected: calendar,
    alertContacts: alerts?.n ?? 0,
    ownerEmail: client?.ownerEmail,
    agentId: client?.retellAgentId,
    aiNumber,
    calls: callCount?.n ?? 0,
    flags,
  });

  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    doneCount,
    total: steps.length,
    complete: doneCount === steps.length,
    finishedAt: client?.setupCompletedAt ?? null,
    reviewNotes: client?.setupFlags?.reviewNotes ?? [],
    hiddenAt: client?.setupFlags?.checklistHiddenAt ?? null,
  };
}
