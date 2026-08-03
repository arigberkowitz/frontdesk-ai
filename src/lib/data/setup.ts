import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertContacts, businessHours, calls, clients, knowledgeItems, services } from "@/db/schema";
import { getBookingProviderForClient } from "@/lib/booking";
import { formatPhone } from "@/lib/format";

export interface SetupStep {
  key: string;
  label: string;
  href: string;
  done: boolean;
  hint?: string;
  /** Can be resolved with "skip for now" (calendar). */
  skippable?: boolean;
  /** Resolved by the owner confirming they did it outside the app (forwarding). */
  manual?: boolean;
}

export interface SetupStatus {
  steps: SetupStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  /** Owner clicked "I'm done" and the AI readiness check passed. */
  finishedAt: Date | null;
  /** Advisory notes from the AI review. Optional improvements, never blockers. */
  reviewNotes: string[];
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
      done: calendar || Boolean(flags.calendarSkipped),
      skippable: true,
      hint:
        !calendar && flags.calendarSkipped
          ? "Skipped — your AI takes messages instead of booking. Connect anytime."
          : "So the AI can book appointments — or skip for now and it takes messages.",
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
      hint: "Go live — this is when your business gets its own AI phone number.",
    },
    {
      key: "forwarding",
      label: "Forward your business line",
      href: "/portal/settings#forwarding",
      done: Boolean(flags.forwardingDone),
      manual: true,
      // Every business gets its own dedicated AI number at activation — show
      // the real one here the moment it exists instead of "your AI number".
      hint: aiNumber
        ? `From your business phone, dial *72 ${aiNumber} (most carriers; AT&T/T-Mobile: **21*${aiNumber.replace(/[^\d+]/g, "")}#). ~2 minutes, undo with *73.`
        : "The dial code contains your AI's own phone number, so it appears here once that number is assigned. Until then, try your AI with a test call in your browser (Your AI page).",
    },
    {
      key: "testcall",
      label: "Make a test call — hear it answer",
      href: "/portal/calls",
      done: (callCount?.n ?? 0) > 0,
      hint: aiNumber
        ? `Call your AI at ${aiNumber}. This checks itself off when your first call appears.`
        : "No number yet? Use “Test call in browser” on the Your AI page. This checks itself off when your first call appears.",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    doneCount,
    total: steps.length,
    complete: doneCount === steps.length,
    finishedAt: client?.setupCompletedAt ?? null,
    reviewNotes: client?.setupFlags?.reviewNotes ?? [],
  };
}
