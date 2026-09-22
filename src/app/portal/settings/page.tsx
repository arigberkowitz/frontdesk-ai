import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listServices } from "@/lib/data/services";
import { listWaiting } from "@/lib/data/waitlist";
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
import { WebhookCard } from "@/components/portal/webhook-card";
import { ReviewRequestsCard } from "@/components/portal/review-requests-card";
import { RecallCard } from "@/components/portal/recall-card";
import { WaitlistCard } from "@/components/portal/waitlist-card";
import { DepositsCard } from "@/components/portal/deposits-card";
import { env } from "@/lib/env";
import { ChatWidgetCard } from "@/components/portal/chat-widget-card";
import { DangerZone } from "@/components/portal/danger-zone";

export const metadata: Metadata = { title: "Settings" };

export default async function PortalSettingsPage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  const alertContacts = await listAlertContacts(clientId).catch(() => []);
  const setup = await getClientSetupStatus(clientId);
  const clientServices = await listServices(clientId).catch(() => []);
  const recallServiceCount = clientServices.filter((s) => s.recallIntervalDays).length;
  const depositServiceCount = clientServices.filter((s) => s.depositCents).length;
  const waitingCount = client.waitlistEnabled ? (await listWaiting(clientId).catch(() => [])).length : 0;

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
      <ReviewRequestsCard
        clientId={clientId}
        enabled={client.reviewRequestsEnabled}
        reviewUrl={client.reviewUrl}
        isAdmin={editAccess.isAdmin}
      />
      <RecallCard
        clientId={clientId}
        enabled={client.recallEnabled}
        recallServiceCount={recallServiceCount}
        isAdmin={editAccess.isAdmin}
      />
      <WaitlistCard
        clientId={clientId}
        enabled={client.waitlistEnabled}
        waitingCount={waitingCount}
        isAdmin={editAccess.isAdmin}
      />
      <DepositsCard
        clientId={clientId}
        enabled={client.depositsEnabled}
        depositLinkUrl={client.depositLinkUrl}
        depositServiceCount={depositServiceCount}
        isAdmin={editAccess.isAdmin}
      />
      {/* The two cards that hand you a <script> tag or a JSON endpoint live
          behind one line. Most owners never need either; the ones who do
          usually have a web person, and this is the line to point them at. */}
      {editAccess.isAdmin ? (
        <details id="advanced" className="group scroll-mt-24 rounded-xl border bg-card">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm [&::-webkit-details-marker]:hidden">
            <span className="font-medium">For your website &amp; other tools</span>
            <span className="text-muted-foreground">
              Chat bubble for your site, and sending leads to a CRM or Zapier. Optional — hand this
              to whoever runs your website.
            </span>
            <span className="ml-auto shrink-0 text-xs font-medium underline underline-offset-2 group-open:hidden">
              Show
            </span>
            <span className="ml-auto hidden shrink-0 text-xs font-medium underline underline-offset-2 group-open:inline">
              Hide
            </span>
          </summary>
          <div className="space-y-6 border-t p-4">
            <ChatWidgetCard
              clientId={clientId}
              enabled={client.chatWidgetEnabled}
              appUrl={env.APP_URL.replace(/\/$/, "")}
              isAdmin={editAccess.isAdmin}
            />
            <WebhookCard
              clientId={clientId}
              url={(client.setupFlags as { webhookUrl?: string }).webhookUrl ?? null}
              secret={(client.setupFlags as { webhookSecret?: string }).webhookSecret ?? null}
              isAdmin={editAccess.isAdmin}
            />
          </div>
        </details>
      ) : null}
      <SupportCard />
      <DangerZone
        clientId={clientId}
        businessName={client.name}
        isAdmin={editAccess.isAdmin}
      />
    </div>
  );
}
