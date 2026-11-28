import { getClientByIdUnsafe } from "@/lib/data/clients";
import {
  gateMessage,
  parseSettings,
} from "@/lib/revenue/quote-followup";
import { getQuoteFollowupStats } from "@/lib/revenue/quote-followup-data";
import { businessGate } from "@/lib/revenue/quote-followup-send";
import { MessageSquareText } from "lucide-react";
import { QuoteFollowupCard } from "@/components/portal/quote-followup-card";
import { ProLockedCard } from "@/components/portal/pro-locked-card";
import { planAccessFor } from "@/lib/plan-access";
import { quoteTeaserFor } from "@/lib/data/revenue-teasers";

/**
 * Server wrapper for the quote follow-up card: loads the saved switch and
 * messages, the results, and whether anything could send right now. Used on the
 * owner's Settings → Follow-ups and on the operator's client page.
 */
export async function QuoteFollowupSection({
  clientId,
  isAdmin,
}: {
  clientId: string;
  isAdmin: boolean;
}) {
  if (!isAdmin) return null;
  const client = await getClientByIdUnsafe(clientId);
  if (!client) return null;
  const settings = parseSettings(client.setupFlags);
  // Pro only. Rescue/Starter see what it would have done, in their own numbers.
  // A business that already had it on still gets the card so it can switch off.
  const access = await planAccessFor(client).catch(() => null);
  if (access && !access.has("quote_followup") && !settings.enabled) {
    const teaser = await quoteTeaserFor(client);
    return (
      <ProLockedCard icon={MessageSquareText} title="Quote follow-up" teaser={teaser} testId="quote-followup-locked" />
    );
  }
  const stats = await getQuoteFollowupStats(clientId).catch(() => null);
  return (
    <QuoteFollowupCard
      clientId={clientId}
      businessName={client.name}
      enabled={settings.enabled}
      step1Template={settings.step1Template}
      step2Template={settings.step2Template}
      askConsent={settings.askConsent === true}
      blockedReason={gateMessage(businessGate(client))}
      stats={stats}
      isAdmin={isAdmin}
    />
  );
}
