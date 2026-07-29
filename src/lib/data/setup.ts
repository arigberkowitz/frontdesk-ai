import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertContacts, businessHours, clients, knowledgeItems, services } from "@/db/schema";
import { getBookingProviderForClient } from "@/lib/booking";

export interface SetupStep {
  key: string;
  label: string;
  href: string;
  done: boolean;
  hint?: string;
}

export interface SetupStatus {
  steps: SetupStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  /** Owner clicked "I'm done" and the AI readiness check passed. */
  finishedAt: Date | null;
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

  const calendar = client ? getBookingProviderForClient(client).isConfigured() : false;

  const steps: SetupStep[] = [
    { key: "services", label: "Add your services", href: "/portal/services", done: (svc?.n ?? 0) > 0 },
    { key: "hours", label: "Set your hours", href: "/portal/hours", done: (hrs?.n ?? 0) > 0 },
    {
      key: "faqs",
      label: "Add a few FAQs",
      href: "/portal/knowledge",
      done: (kb?.n ?? 0) > 0,
      hint: "Teach it the questions callers ask.",
    },
    {
      key: "greeting",
      label: "Set your greeting & voice",
      href: "/portal/guidelines",
      done: Boolean(client?.greeting?.trim()),
    },
    {
      key: "calendar",
      label: "Connect your calendar",
      href: "/portal/appointments",
      done: calendar,
      hint: "So the AI can book appointments.",
    },
    {
      key: "alerts",
      label: "Choose who gets alerts",
      href: "/portal/settings",
      done: (alerts?.n ?? 0) > 0 || Boolean(client?.ownerEmail?.trim()),
      hint: "Who we text or email when a lead or emergency comes in.",
    },
    {
      key: "live",
      label: "Activate your receptionist",
      href: "/portal/guidelines",
      done: Boolean(client?.retellAgentId),
      hint: "Go live and start taking calls.",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    doneCount,
    total: steps.length,
    complete: doneCount === steps.length,
    finishedAt: client?.setupCompletedAt ?? null,
  };
}
