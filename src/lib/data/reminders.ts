import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { reminders, type NewReminder, type Reminder } from "@/db/schema";

/** Reminder log access — every call/text reminder a business sent its customers. */

export async function listRemindersForClient(clientId: string): Promise<Reminder[]> {
  return db.query.reminders.findMany({
    where: eq(reminders.clientId, clientId),
    orderBy: [desc(reminders.createdAt)],
    limit: 500,
  });
}

/** Reminders grouped by appointment, newest first, for inline per-appointment history. */
export async function remindersByAppointment(
  clientId: string,
): Promise<Record<string, Reminder[]>> {
  const rows = await listRemindersForClient(clientId);
  const map: Record<string, Reminder[]> = {};
  for (const r of rows) {
    if (!r.appointmentId) continue;
    (map[r.appointmentId] ??= []).push(r);
  }
  return map;
}

/** Reminders grouped by lead, newest first — for follow-up history on the Leads page. */
export async function remindersByLead(clientId: string): Promise<Record<string, Reminder[]>> {
  const rows = await listRemindersForClient(clientId);
  const map: Record<string, Reminder[]> = {};
  for (const r of rows) {
    if (!r.leadId) continue;
    (map[r.leadId] ??= []).push(r);
  }
  return map;
}

/**
 * Texts we promised and didn't deliver, recently.
 *
 * A failed text is the quietest failure in this product. The caller agrees on a
 * recorded line to be texted a confirmation, the send fails, a row is written
 * with status "failed", and nobody ever looks at it. Production's Twilio
 * credentials were being rejected for days and the only symptom anyone noticed
 * was one person saying they never got a text. This is what makes it visible.
 */
export async function failedTextsSince(
  clientId: string,
  days = 7,
): Promise<{ count: number; latestError: string | null; latestAt: Date | null }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.query.reminders.findMany({
    where: (r, { and, eq: eqOp, gte }) =>
      and(eqOp(r.clientId, clientId), eqOp(r.status, "failed"), gte(r.createdAt, since)),
    orderBy: [desc(reminders.createdAt)],
    limit: 50,
  });
  return {
    count: rows.length,
    latestError: rows[0]?.error ?? null,
    latestAt: rows[0]?.createdAt ?? null,
  };
}

export async function createReminder(
  clientId: string,
  input: Omit<NewReminder, "clientId" | "id">,
): Promise<Reminder> {
  const [row] = await db.insert(reminders).values({ ...input, clientId }).returning();
  if (!row) throw new Error("Failed to record reminder");
  return row;
}

/** A single appointment scoped to its client (portal-safe). */
export async function getClientAppointment(clientId: string, appointmentId: string) {
  return db.query.appointments.findFirst({
    where: (a, { and: andOp, eq: eqOp, isNull }) =>
      andOp(eqOp(a.id, appointmentId), eqOp(a.clientId, clientId), isNull(a.deletedAt)),
    with: { service: true },
  });
}
