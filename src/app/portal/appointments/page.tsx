import type { Metadata } from "next";
import { CalendarCheck } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listAppointments } from "@/lib/data/appointments";
import { remindersByAppointment } from "@/lib/data/reminders";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AppointmentsView } from "@/components/appointments-view";
import { CalendarConnect } from "@/components/calendar-connect";
import { CalendarStatusToast } from "@/components/calendar-status-toast";
import { capVocab, vocabFor } from "@/lib/vocab";

export const metadata: Metadata = { title: "Appointments" };

export default async function PortalAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const { clientId } = await resolvePortalClient();
  const [client, appointments, reminderMap, sp] = await Promise.all([
    getClientByIdUnsafe(clientId),
    listAppointments(clientId),
    remindersByAppointment(clientId),
    searchParams,
  ]);
  const v = vocabFor(client?.industry);
  const items = appointments.map((a) => ({
    id: a.id,
    callId: a.callId,
    customerName: a.customerName,
    customerPhone: a.customerPhone,
    startAt: a.startAt,
    endAt: a.endAt,
    status: a.status,
    serviceName: a.service?.name ?? null,
  }));
  // Serialize reminder rows to the lightweight shape the client view needs.
  const reminders: Record<string, { channel: string; status: string; at: string }[]> = {};
  for (const [apptId, rows] of Object.entries(reminderMap)) {
    reminders[apptId] = rows.map((r) => ({
      channel: r.channel,
      status: r.status,
      at: (r.sentAt ?? r.createdAt).toISOString(),
    }));
  }

  return (
    <div className="space-y-6">
      <CalendarStatusToast status={sp.calendar} returnTo="/portal/appointments" />
      <PageHeader title={capVocab(v.appointments)} description="Booked by your AI receptionist." />
      <CalendarConnect
        clientId={clientId}
        provider={client?.calendarProvider ?? null}
        account={client?.calendarAccount ?? null}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={`No ${v.appointments} yet`}
          description={`${capVocab(v.appointments)} your AI books will show up here.`}
        />
      ) : (
        <AppointmentsView
          appointments={items}
          callBasePath="/portal/calls"
          clientId={clientId}
          reminders={reminders}
        />
      )}
    </div>
  );
}
