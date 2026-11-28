import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listServices } from "@/lib/data/services";
import { getBookingProviderForClient } from "@/lib/booking";
import { planAccessFor } from "@/lib/plan-access";
import { env } from "@/lib/env";
import { DEDUPE_DAYS, MAX_CALLBACKS_PER_CLIENT_PER_DAY } from "@/lib/missed-call";
import { REBOOK_OFFER_HOURS } from "@/lib/rebook";
import { AI_REPLIES_PER_THREAD_PER_DAY } from "@/lib/sms-ai/rules";
import type { FeatureFacts } from "@/lib/feature-toggles";
import { FeaturesPanel } from "@/components/portal/features-panel";

export const metadata: Metadata = { title: "Features · Settings" };

/**
 * Settings → Features: every owner-controllable on/off in one list, each with
 * a "What's this?" explainer. It's also the optional "Choose your features"
 * step of guided setup (?from=setup). Every switch saves through the action
 * that already owns that setting, so this page and the rest of Settings can
 * never disagree.
 */
export default async function PortalSettingsFeaturesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { clientId } = await resolvePortalClient();
  const [editAccess, client, sp] = await Promise.all([
    getPortalEditAccess(clientId),
    getClientByIdUnsafe(clientId),
    searchParams,
  ]);
  if (!client) notFound();
  const [clientServices, access] = await Promise.all([
    listServices(clientId).catch(() => []),
    planAccessFor(client).catch(() => null),
  ]);
  let bookingEnabled = false;
  try {
    bookingEnabled = getBookingProviderForClient(client).isConfigured();
  } catch {
    bookingEnabled = false;
  }
  const flags = client.setupFlags ?? {};
  const facts: FeatureFacts = {
    handoffMode: flags.handoffMode ?? "always",
    escalationNumber: client.escalationNumber ?? null,
    humanHandoffEnabled: client.humanHandoffEnabled,
    languages: client.languages,
    staffModeEnabled: client.staffModeEnabled,
    // Unknown plan (lookup failed) fails open, like resolveFeatures; the action re-checks.
    staffModeAllowed: access ? access.has("staff_mode") : true,
    aiTextRepliesEnabled: client.aiTextRepliesEnabled,
    aiTextPauseHours: client.aiTextPauseHours,
    missedCallTextsEnabled: client.missedCallTextsEnabled,
    missedCallAiCallbacksEnabled: client.missedCallAiCallbacksEnabled,
    aiCallbacksAvailable: env.MISSED_CALL_AI_CALLBACKS,
    smartRebookingEnabled: client.smartRebookingEnabled,
    outboundRecoveryEnabled: client.outboundRecoveryEnabled,
    reviewRequestsEnabled: client.reviewRequestsEnabled,
    reviewRequestsAllowed: access ? access.has("review_requests") : true,
    reviewUrl: client.reviewUrl ?? null,
    recallEnabled: client.recallEnabled,
    recallServiceCount: clientServices.filter((s) => s.recallIntervalDays).length,
    waitlistEnabled: client.waitlistEnabled,
    depositsEnabled: client.depositsEnabled,
    depositLinkUrl: client.depositLinkUrl ?? null,
    smsAlertsEnabled: client.smsAlertsEnabled,
    weeklySummaryEnabled: client.weeklySummaryEnabled,
    dailyBriefingEnabled: flags.dailyBriefing === true,
    morningUnbookedTextEnabled: flags.morningUnbookedText === true,
    ownerEmail: client.ownerEmail?.trim() || null,
    chatWidgetEnabled: client.chatWidgetEnabled,
    chatWidgetAllowed: access ? access.has("website_chat") : true,
  };

  return (
    <FeaturesPanel
      clientId={clientId}
      isAdmin={editAccess.isAdmin}
      facts={facts}
      bookingEnabled={bookingEnabled}
      limits={{
        repliesPerThreadPerDay: AI_REPLIES_PER_THREAD_PER_DAY,
        callbackDedupeDays: DEDUPE_DAYS,
        callbacksPerDay: MAX_CALLBACKS_PER_CLIENT_PER_DAY,
        rebookOfferHours: REBOOK_OFFER_HOURS,
      }}
      // The setup step's intro + "Continue / Skip" bar: arriving from the
      // checklist, or until the owner has been through it once.
      setupMode={sp.from === "setup" || (!flags.featuresReviewed && !client.setupCompletedAt)}
    />
  );
}
