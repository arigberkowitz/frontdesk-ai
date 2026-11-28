import { HeartHandshake } from "lucide-react";
import type { Client } from "@/db/schema";
import { planAccessFor } from "@/lib/plan-access";
import { revenueTextStats } from "@/lib/data/revenue-texts";
import { winbackTeaserFor } from "@/lib/data/revenue-teasers";
import { statsLine } from "@/lib/revenue-texts";
import { winbackSettingsOf } from "@/lib/winback";
import { WinbackCard } from "@/components/portal/winback-card";
import { ProLockedCard } from "@/components/portal/pro-locked-card";

/**
 * Settings → Follow-ups: the win-back card on Pro, or the locked card with
 * this business's own numbers on Missed-Call Rescue and Starter.
 */
export async function WinbackSection({ client, isAdmin }: { client: Client; isAdmin: boolean }) {
  if (!isAdmin) return null;
  // A failed plan lookup fails open, like the rest of the portal; the server
  // action and the cron re-check the plan either way.
  const access = await planAccessFor(client).catch(() => null);
  if (access && !access.has("winback")) {
    const teaser = await winbackTeaserFor(client);
    return <ProLockedCard icon={HeartHandshake} title="Win-back texts" teaser={teaser} testId="winback-locked" />;
  }
  const settings = winbackSettingsOf(client.setupFlags);
  const results = statsLine(await revenueTextStats(client.id, "winback"));
  return (
    <WinbackCard
      clientId={client.id}
      businessName={client.name}
      enabled={settings.enabled}
      months={settings.months}
      template={settings.template}
      results={results}
      isAdmin={isAdmin}
    />
  );
}
