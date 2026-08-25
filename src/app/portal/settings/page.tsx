import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listAlertContacts } from "@/lib/data/alert-contacts";
import { getClientSetupStatus } from "@/lib/data/setup";
import { AiNumberCard } from "@/components/portal/ai-number-card";
import { AlertRoster } from "@/components/portal/alert-roster";
import { HandoffCard } from "@/components/portal/handoff-card";
import { PageHeader } from "@/components/page-header";
import { EditLockBanner } from "@/components/portal/edit-lock-banner";
import { PortalSettings } from "@/components/portal/portal-settings";
import { ReceptionistPower } from "@/components/portal/receptionist-power";
import { SetupChecklist } from "@/components/portal/setup-checklist";
import { SupportCard } from "@/components/portal/support-card";
import { DangerZone } from "@/components/portal/danger-zone";

export const metadata: Metadata = { title: "Settings" };

export default async function PortalSettingsPage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  const alertContacts = await listAlertContacts(clientId).catch(() => []);
  const setup = await getClientSetupStatus(clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your business details, where we send alerts, and how to reach us for help."
      />
      {!editAccess.canEdit ? (
        <EditLockBanner clientId={clientId} hasCode={editAccess.hasCode} />
      ) : null}
      <ReceptionistPower
        clientId={clientId}
        status={client.status}
        isAdmin={editAccess.isAdmin}
      />
      <AiNumberCard
        clientId={clientId}
        phoneNumber={client.retellPhoneNumber}
        mode={client.answeringMode === "missed_only" ? "missed_only" : "all_calls"}
        forwardingDone={Boolean(client.setupFlags?.forwardingDone)}
        isAdmin={editAccess.isAdmin}
        canEdit={editAccess.canEdit}
      />
      {/* High in the page on purpose: the wrong value here is the worst call
          this product can make. */}
      <HandoffCard
        clientId={clientId}
        mode={client.setupFlags?.handoffMode ?? "always"}
        escalationNumber={client.escalationNumber}
      />
      <PortalSettings client={client} isAdmin={editAccess.isAdmin} />
      <AlertRoster clientId={clientId} contacts={alertContacts} />
      <SetupChecklist
        clientId={clientId}
        variant="settings"
        canEdit={editAccess.canEdit}
        status={{ ...setup, finishedAt: setup.finishedAt?.toISOString() ?? null }}
      />
      <SupportCard />
      <DangerZone
        clientId={clientId}
        businessName={client.name}
        isAdmin={editAccess.isAdmin}
      />
    </div>
  );
}
