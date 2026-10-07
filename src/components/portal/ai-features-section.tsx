import type { Client } from "@/db/schema";
import { getBookingProviderForClient } from "@/lib/booking";
import { getAiFeatureStats } from "@/lib/data/ai-features";
import { aiFeatureStatus, type AiFeatureFlags } from "@/lib/ai-features";
import { env } from "@/lib/env";
import { DEDUPE_DAYS, MAX_CALLBACKS_PER_CLIENT_PER_DAY } from "@/lib/missed-call";
import { REBOOK_OFFER_HOURS } from "@/lib/rebook";
import { AI_REPLIES_PER_THREAD_PER_DAY } from "@/lib/sms-ai/rules";
import { AiFeaturesCard } from "@/components/portal/ai-features-card";

/**
 * Server half of the Overview "AI features" switchboard: reads the flags off
 * the client row the page already loaded, fetches the recent counts, and hands
 * the card its status lines. Rendered inside <Suspense> so the counts never
 * hold up the rest of the Overview.
 */
export async function AiFeaturesSection({ client, isAdmin }: { client: Client; isAdmin: boolean }) {
  const flags: AiFeatureFlags = {
    aiTextRepliesEnabled: client.aiTextRepliesEnabled,
    missedCallTextsEnabled: client.missedCallTextsEnabled,
    missedCallAiCallbacksEnabled: client.missedCallAiCallbacksEnabled,
    smartRebookingEnabled: client.smartRebookingEnabled,
    dailyBriefingEnabled: client.setupFlags?.dailyBriefing === true,
    ownerEmail: client.ownerEmail,
  };
  const stats = await getAiFeatureStats(client.id, {
    aiTextReplies: flags.aiTextRepliesEnabled,
    missedCallTexts: flags.missedCallTextsEnabled,
    smartRebooking: flags.smartRebookingEnabled,
    dailyBriefing: flags.dailyBriefingEnabled,
  });
  const opts = { timeZone: client.timezone };
  let bookingEnabled = false;
  try {
    bookingEnabled = getBookingProviderForClient(client).isConfigured();
  } catch {
    bookingEnabled = false;
  }

  return (
    <AiFeaturesCard
      clientId={client.id}
      isAdmin={isAdmin}
      aiTextReplies={{
        enabled: flags.aiTextRepliesEnabled,
        pauseHours: client.aiTextPauseHours,
        status: aiFeatureStatus("aiTextReplies", flags, stats, opts),
        bookingEnabled,
      }}
      missedCall={{
        enabled: flags.missedCallTextsEnabled,
        status: aiFeatureStatus("missedCallTexts", flags, stats, opts),
        // The AI phone callback stays behind its platform switch.
        aiCallbacksAvailable: env.MISSED_CALL_AI_CALLBACKS,
        aiCallbacksEnabled: env.MISSED_CALL_AI_CALLBACKS && flags.missedCallAiCallbacksEnabled,
      }}
      smartRebooking={{
        enabled: flags.smartRebookingEnabled,
        status: aiFeatureStatus("smartRebooking", flags, stats, opts),
      }}
      dailyBriefing={{
        enabled: flags.dailyBriefingEnabled,
        status: aiFeatureStatus("dailyBriefing", flags, stats, opts),
        ownerEmail: client.ownerEmail?.trim() || null,
      }}
      limits={{
        repliesPerThreadPerDay: AI_REPLIES_PER_THREAD_PER_DAY,
        callbackDedupeDays: DEDUPE_DAYS,
        callbacksPerDay: MAX_CALLBACKS_PER_CLIENT_PER_DAY,
        rebookOfferHours: REBOOK_OFFER_HOURS,
      }}
    />
  );
}

/** Same footprint as the card while its counts load. */
export function AiFeaturesSkeleton() {
  return (
    <div aria-hidden className="h-[22rem] animate-pulse rounded-xl border bg-card/60 sm:h-72" />
  );
}
