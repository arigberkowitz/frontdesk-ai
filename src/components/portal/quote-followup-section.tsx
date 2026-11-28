import { getClientByIdUnsafe } from "@/lib/data/clients";
import {
  gateMessage,
  parseSettings,
} from "@/lib/revenue/quote-followup";
import { getQuoteFollowupStats } from "@/lib/revenue/quote-followup-data";
import { businessGate } from "@/lib/revenue/quote-followup-send";
import { QuoteFollowupCard } from "@/components/portal/quote-followup-card";

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
  const stats = await getQuoteFollowupStats(clientId).catch(() => null);
  return (
    <QuoteFollowupCard
      clientId={clientId}
      businessName={client.name}
      enabled={settings.enabled}
      step1Template={settings.step1Template}
      step2Template={settings.step2Template}
      blockedReason={gateMessage(businessGate(client))}
      stats={stats}
      isAdmin={isAdmin}
    />
  );
}
