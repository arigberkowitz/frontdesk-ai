import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { EditLockBanner } from "@/components/portal/edit-lock-banner";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { integrations } from "@/lib/env";
import { CalendarConnect } from "@/components/calendar-connect";
import { CalendarStatusToast } from "@/components/calendar-status-toast";
import { BusyCalendarsCard, type BusyCalendarsData } from "@/components/portal/busy-calendars-card";
import { loadOwnerCalendars } from "@/lib/busy-calendars";

export const metadata: Metadata = { title: "Calendar · Settings" };

/** Settings → Calendar: Google / Outlook / Cal.com sync. */
export default async function PortalSettingsCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const sp = await searchParams;
  const { clientId } = await resolvePortalClient();
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  // Connecting a calendar changes where the AI books, so it's an editor job
  // (enforced in the connect routes); staff see how to unlock instead of a 403.
  const editAccess = await getPortalEditAccess(clientId);
  // Google / Outlook only: Cal.com manages its own busy calendars.
  const owner = await loadOwnerCalendars(client);
  const busyData: BusyCalendarsData | null =
    owner.kind === "unsupported"
      ? null
      : owner.kind === "microsoft"
        ? { kind: "microsoft", calendars: owner.calendars }
        : owner;

  return (
    <section id="calendar" className="space-y-2">
      <CalendarStatusToast status={sp.calendar} returnTo="/portal/settings/calendar" />
      {!editAccess.canEdit ? <EditLockBanner clientId={clientId} hasCode={editAccess.hasCode} /> : null}
      <CalendarConnect
        clientId={clientId}
        provider={client.calendarProvider ?? null}
        account={client.calendarAccount ?? null}
        microsoftReady={integrations.microsoft()}
        googleReady={integrations.google()}
        from="settings"
      />
      {busyData ? (
        <BusyCalendarsCard
          clientId={clientId}
          account={client.calendarAccount ?? null}
          data={busyData}
          selected={client.calendarBusyIds ?? []}
          canEdit={editAccess.canEdit}
        />
      ) : null}
    </section>
  );
}
