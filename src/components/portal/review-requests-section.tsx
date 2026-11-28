import { Star } from "lucide-react";
import type { Client } from "@/db/schema";
import { planAccessFor } from "@/lib/plan-access";
import { revenueTextStats } from "@/lib/data/revenue-texts";
import { reviewTeaserFor } from "@/lib/data/revenue-teasers";
import { statsLine } from "@/lib/revenue-texts";
import { reviewDelayOf } from "@/lib/review-requests";
import { ReviewRequestsCard } from "@/components/portal/review-requests-card";
import { ProLockedCard } from "@/components/portal/pro-locked-card";

/**
 * Settings → Follow-ups: review requests on Pro, or the locked card with this
 * business's own numbers on Missed-Call Rescue and Starter. A business that
 * already had it switched on still sees the card so it can turn it off.
 */
export async function ReviewRequestsSection({ client, isAdmin }: { client: Client; isAdmin: boolean }) {
  const access = await planAccessFor(client).catch(() => null);
  if (access && !access.has("review_requests") && !client.reviewRequestsEnabled) {
    const teaser = await reviewTeaserFor(client);
    return <ProLockedCard icon={Star} title="Review requests" teaser={teaser} testId="review-requests-locked" />;
  }
  const results = statsLine(await revenueTextStats(client.id, "review_request"));
  return (
    <ReviewRequestsCard
      clientId={client.id}
      businessName={client.name}
      enabled={client.reviewRequestsEnabled}
      reviewUrl={client.reviewUrl}
      delayHours={reviewDelayOf(client.setupFlags)}
      results={results}
      isAdmin={isAdmin}
    />
  );
}
