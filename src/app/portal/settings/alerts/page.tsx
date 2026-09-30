import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listAlertContacts } from "@/lib/data/alert-contacts";
import { AlertRoster } from "@/components/portal/alert-roster";
import { AlertsForm } from "@/components/portal/portal-settings";

export const metadata: Metadata = { title: "Alerts · Settings" };

/** Settings → Alerts: where notifications go, the on-duty roster, the weekly summary. */
export default async function PortalSettingsAlertsPage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  const alertContacts = await listAlertContacts(clientId).catch(() => []);

  return (
    <div className="space-y-6">
      <AlertsForm client={client} isAdmin={editAccess.isAdmin} />
      <AlertRoster clientId={clientId} contacts={alertContacts} canManage={editAccess.isAdmin} />
    </div>
  );
}
