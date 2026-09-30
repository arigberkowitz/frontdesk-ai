import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { integrations } from "@/lib/env";
import { CalendarConnect } from "@/components/calendar-connect";
import { CalendarStatusToast } from "@/components/calendar-status-toast";

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

  return (
    <section id="calendar" className="space-y-2">
      <CalendarStatusToast status={sp.calendar} returnTo="/portal/settings/calendar" />
      <CalendarConnect
        clientId={clientId}
        provider={client.calendarProvider ?? null}
        account={client.calendarAccount ?? null}
        microsoftReady={integrations.microsoft()}
        googleReady={integrations.google()}
        from="settings"
      />
    </section>
  );
}
