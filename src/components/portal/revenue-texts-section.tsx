import Link from "next/link";
import { Lock, TrendingUp } from "lucide-react";
import type { Client } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/panel-header";
import { getRevenueOverview, type RevenueOverview } from "@/lib/data/revenue-overview";
import { UPGRADE_HREF } from "@/components/portal/pro-locked-card";
import { formatCurrencyCents } from "@/lib/format";
import { PLANS } from "@/config/plans";

/**
 * Overview: on Missed-Call Rescue and Starter, what the Pro texts would have
 * done for this business in its own numbers; on Pro, what they did. Hidden
 * when there's nothing real to say.
 */
export async function RevenueTextsSection({ client }: { client: Client }) {
  const overview = await getRevenueOverview(client).catch(() => null);
  return <RevenueTextsView overview={overview} businessName={client.name} />;
}

/** The presentational half, so it renders the same in tests and previews. */
export function RevenueTextsView({ overview, businessName }: { overview: RevenueOverview; businessName: string }) {
  if (!overview) return null;

  if (overview.mode === "results") {
    return (
      <Card data-testid="revenue-results">
        <CardContent className="p-5 sm:p-6">
          <PanelHeader icon={TrendingUp} title="Follow-up texts" description="What your Pro follow-ups did. Counts only, from your own messages and bookings." />
          <ul className="mt-4 space-y-2 text-sm sm:ml-12">
            {overview.items.map((i) => (
              <li key={i.feature}>
                <span className="font-medium">{i.title}:</span>{" "}
                <span className="text-muted-foreground">{i.line}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="revenue-teaser">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={TrendingUp}
          title={
            <span className="flex items-center gap-2">
              What Pro would do for {businessName}
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-700">
                <Lock className="size-3" /> Pro
              </span>
            </span>
          }
          description="Counted from your own calls and appointments."
        />
        <ul className="mt-4 space-y-3 sm:ml-12">
          {overview.items.map((i) => (
            <li key={i.feature} className="text-sm">
              <p className="font-medium">{i.title}</p>
              <p className="text-foreground">{i.teaser.line}</p>
              {i.teaser.detail ? <p className="text-muted-foreground">{i.teaser.detail}</p> : null}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-3 sm:ml-12">
          <Button size="sm" render={<Link href={UPGRADE_HREF} />} nativeButton={false}>
            Upgrade to Pro
          </Button>
          <Link href="/portal/settings/follow-ups" className="text-sm underline underline-offset-2">
            See the texts
          </Link>
          <span className="text-xs text-muted-foreground">
            {formatCurrencyCents(PLANS.pro.monthlyPriceCents)}/mo, one flat monthly price.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
