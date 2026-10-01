import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listServices } from "@/lib/data/services";
import { listWaiting } from "@/lib/data/waitlist";
import { env } from "@/lib/env";
import { RecoveryTextsForm } from "@/components/portal/portal-settings";
import { ReviewRequestsCard } from "@/components/portal/review-requests-card";
import { RecallCard } from "@/components/portal/recall-card";
import { WaitlistCard } from "@/components/portal/waitlist-card";
import { DepositsCard } from "@/components/portal/deposits-card";
import { ChatWidgetCard } from "@/components/portal/chat-widget-card";
import { WebhookCard } from "@/components/portal/webhook-card";
import { toSafeClient } from "@/lib/client-safe";
import { AiTextRepliesCard } from "@/components/portal/ai-text-replies-card";
import { getBookingProviderForClient } from "@/lib/booking";
import { MissedCallCard } from "@/components/portal/missed-call-card";
import { callbackStats } from "@/lib/data/call-callbacks";

export const metadata: Metadata = { title: "Follow-ups · Settings" };

/** Settings → Follow-ups: the optional automations, plus the website/CRM extras. */
export default async function PortalSettingsFollowUpsPage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  const clientServices = await listServices(clientId).catch(() => []);
  const recallServiceCount = clientServices.filter((s) => s.recallIntervalDays).length;
  const depositServiceCount = clientServices.filter((s) => s.depositCents).length;
  const waitingCount = client.waitlistEnabled
    ? (await listWaiting(clientId).catch(() => [])).length
    : 0;

  const missedCallStats = client.missedCallTextsEnabled
    ? await callbackStats(clientId).catch(() => null)
    : null;

  return (
    <div className="space-y-6">
      <RecoveryTextsForm client={toSafeClient(client)} />
      <AiTextRepliesCard
        clientId={clientId}
        enabled={client.aiTextRepliesEnabled}
        pauseHours={client.aiTextPauseHours}
        isAdmin={editAccess.isAdmin}
        bookingEnabled={(() => {
          try {
            return getBookingProviderForClient(client).isConfigured();
          } catch {
            return false;
          }
        })()}
      />
      <MissedCallCard
        clientId={clientId}
        businessName={client.name}
        enabled={client.missedCallTextsEnabled}
        aiCallbacksEnabled={client.missedCallAiCallbacksEnabled}
        aiCallbacksAvailable={env.MISSED_CALL_AI_CALLBACKS}
        stats={missedCallStats ?? { sent: 0, skipped: 0, pending: 0, failed: 0 }}
        isAdmin={editAccess.isAdmin}
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
    </div>
  );
}
