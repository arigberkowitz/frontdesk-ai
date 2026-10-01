import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getClientSetupStatus } from "@/lib/data/setup";
import { BusinessDetailsForm } from "@/components/portal/portal-settings";
import { SetupChecklist } from "@/components/portal/setup-checklist";
import { DangerZone } from "@/components/portal/danger-zone";
import { LegacySettingsHash } from "@/components/portal/legacy-settings-hash";
import { toSafeClient } from "@/lib/client-safe";

export const metadata: Metadata = { title: "Settings" };

/** Settings → Business (the section /portal/settings opens on). */
export default async function PortalSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const sp = await searchParams;
  // Calendar connect used to return here (?calendar=connected|error). Anyone
  // mid-OAuth when this shipped still lands on the right section.
  if (sp.calendar) {
    redirect(`/portal/settings/calendar?calendar=${encodeURIComponent(sp.calendar)}`);
  }
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  const setup = await getClientSetupStatus(clientId);

  return (
    <div className="space-y-6">
      <LegacySettingsHash />
      <BusinessDetailsForm client={toSafeClient(client)} />
      <SetupChecklist
        clientId={clientId}
        variant="settings"
        canEdit={editAccess.canEdit}
        status={{ ...setup, finishedAt: setup.finishedAt?.toISOString() ?? null }}
      />
      <DangerZone clientId={clientId} businessName={client.name} isAdmin={editAccess.isAdmin} />
    </div>
  );
}
