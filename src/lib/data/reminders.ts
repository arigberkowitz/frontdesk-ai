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
