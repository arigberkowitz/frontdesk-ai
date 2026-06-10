import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { businessHours, type BusinessHour } from "@/db/schema";

/** Weekly business hours. One row per (client, day_of_week). */

export async function listHours(clientId: string): Promise<BusinessHour[]> {
  return db.query.businessHours.findMany({
    where: eq(businessHours.clientId, clientId),
    orderBy: [asc(businessHours.dayOfWeek)],
  });
}

export interface DayHoursInput {
  dayOfWeek: number;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
}

/** Upsert one day's hours (unique on client_id + day_of_week). */
export async function upsertDayHours(clientId: string, input: DayHoursInput): Promise<void> {
  await db
    .insert(businessHours)
    .values({
      clientId,
      dayOfWeek: input.dayOfWeek,
      isClosed: input.isClosed,
      openTime: input.openTime,
      closeTime: input.closeTime,
    })
    .onConflictDoUpdate({
      target: [businessHours.clientId, businessHours.dayOfWeek],
      set: { isClosed: input.isClosed, openTime: input.openTime, closeTime: input.closeTime },
    });
}

/** Replace the full week in one transaction. */
export async function setWeekHours(clientId: string, days: DayHoursInput[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const d of days) {
      await tx
        .insert(businessHours)
        .values({
          clientId,
          dayOfWeek: d.dayOfWeek,
          isClosed: d.isClosed,
          openTime: d.openTime,
          closeTime: d.closeTime,
        })
        .onConflictDoUpdate({
          target: [businessHours.clientId, businessHours.dayOfWeek],
          set: { isClosed: d.isClosed, openTime: d.openTime, closeTime: d.closeTime },
        });
    }
  });
}
