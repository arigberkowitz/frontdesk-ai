import type { Metadata } from "next";
import { CalendarCheck } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listAppointments } from "@/lib/data/appointments";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AppointmentsView } from "@/components/appointments-view";
import { CalendarConnect } from "@/components/calendar-connect";
import { CalendarStatusToast } from "@/components/calendar-status-toast";

export const metadata: Metadata = { title: "Appointments" };

export default async function PortalAppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const { clientId } = await resolvePortalClient();
  const [client, appointments, sp] = await Promise.all([
    getClientByIdUnsafe(clientId),
    listAppointments(clientId),
    searchParams,
  ]);
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

  return (
    <div className="space-y-6">
      <CalendarStatusToast status={sp.calendar} returnTo="/portal/appointments" />
      <PageHeader title="Appointments" description="Booked by your AI receptionist." />
      <CalendarConnect
        clientId={clientId}
        provider={client?.calendarProvider ?? null}
        account={client?.calendarAccount ?? null}
      />
      {items.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No appointments yet"
          description="Appointments your AI books will show up here."
        />
      ) : (
        <AppointmentsView appointments={items} callBasePath="/portal/calls" />
      )}
    </div>
  );
}
