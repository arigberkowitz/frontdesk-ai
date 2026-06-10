import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { appointments, type NewAppointment } from "@/db/schema";

export async function listAppointments(clientId: string) {
  return db.query.appointments.findMany({
    where: and(eq(appointments.clientId, clientId), isNull(appointments.deletedAt)),
    orderBy: [desc(appointments.startAt)],
    with: { service: true },
  });
}

export async function createAppointment(
  clientId: string,
  input: Omit<NewAppointment, "clientId" | "id">,
) {
  const [row] = await db.insert(appointments).values({ ...input, clientId }).returning();
  if (!row) throw new Error("Failed to create appointment");
  return row;
}
