import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listAlertContacts } from "@/lib/data/alert-contacts";
import { AlertRoster } from "@/components/portal/alert-roster";
import { AlertsForm } from "@/components/portal/portal-settings";
import { toSafeClient } from "@/lib/client-safe";
import { PushOptInSection } from "@/components/portal/push-opt-in-section";

export const metadata: Metadata = { title: "Alerts · Settings" };

/** Settings → Alerts: where notifications go, phone notifications, the on-duty roster. */
export default async function PortalSettingsAlertsPage() {
  const { clientId, preview } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  const alertContacts = await listAlertContacts(clientId).catch(() => []);

  return (
    <div className="space-y-6">
      <AlertsForm client={toSafeClient(client)} isAdmin={editAccess.isAdmin} />
      <PushOptInSection clientId={clientId} preview={preview} />
      <AlertRoster clientId={clientId} contacts={alertContacts} canManage={editAccess.isAdmin} />
    </div>
  );
}
