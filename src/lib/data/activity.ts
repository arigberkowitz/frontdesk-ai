import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { appointments, calls, leads } from "@/db/schema";

export interface ActivityItem {
  kind: "booking" | "message" | "afterhours";
  title: string;
  detail: string;
  at: string; // ISO
}

/** Merged recent activity (bookings, messages, after-hours catches), newest first. */
export async function getClientActivity(clientId: string, limit = 8): Promise<ActivityItem[]> {
  const [appts, ld, afterHours] = await Promise.all([
    db.query.appointments.findMany({
      where: and(eq(appointments.clientId, clientId), isNull(appointments.deletedAt)),
      orderBy: [desc(appointments.createdAt)],
      limit,
      with: { service: true },
    }),
    db.query.leads.findMany({
      where: and(eq(leads.clientId, clientId), isNull(leads.deletedAt)),
      orderBy: [desc(leads.createdAt)],
      limit,
    }),
    db.query.calls.findMany({
      where: and(eq(calls.clientId, clientId), eq(calls.isAfterHours, true), isNull(calls.deletedAt)),
      orderBy: [desc(calls.startAt)],
      limit,
    }),
  ]);

  const items: ActivityItem[] = [];
  for (const a of appts) {
    items.push({
      kind: "booking",
      title: "Appointment booked",
      detail: [a.customerName ?? "Caller", a.service?.name].filter(Boolean).join(" · "),
      at: a.createdAt.toISOString(),
    });
  }
  for (const l of ld) {
    items.push({
      kind: "message",
      title: "Message captured",
      detail: [l.name ?? "Caller", l.reason ?? l.service].filter(Boolean).join(" · "),
      at: l.createdAt.toISOString(),
    });
  }
  for (const c of afterHours) {
    items.push({
      kind: "afterhours",
      title: "After-hours call caught",
      detail: c.summary ?? "Answered a call while you were closed",
      at: (c.startAt ?? c.createdAt).toISOString(),
    });
  }

  return items.sort((x, y) => y.at.localeCompare(x.at)).slice(0, limit);
}
