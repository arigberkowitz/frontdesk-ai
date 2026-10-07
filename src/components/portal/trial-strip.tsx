"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock } from "lucide-react";
import { UpgradeButton } from "@/components/portal/upgrade-button";
import { cn } from "@/lib/utils";

/**
 * The trial countdown on every portal page — one slim line under the header.
 * The Overview carries the full card (stats, reminder) so it's hidden there.
 */
export function TrialStrip({
  headline,
  shortHeadline,
  summary,
  urgent,
  upgrade,
}: {
  headline: string;
  /** What fits next to the button on a phone ("9 days left"). */
  shortHeadline: string;
  /** Short "what it's done" line, from real data. */
  summary: string | null;
  urgent: boolean;
  /** Direct checkout for the owner; otherwise a link to the plans. */
  upgrade: { clientId: string; planKey: string; label: string } | null;
}) {
  const pathname = usePathname();
  if (pathname === "/portal") return null;
  return (
    <div
      role="status"
      data-testid="trial-strip"
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2 text-sm sm:px-6",
        urgent ? "border-amber-500/30 bg-amber-500/10" : "border-brand/15 bg-brand-soft/60",
      )}
    >
      <Clock className={cn("size-4 shrink-0", urgent ? "text-amber-600" : "text-brand")} />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-medium sm:hidden">{shortHeadline}</span>
        <span className="hidden font-medium sm:inline">{headline}</span>
        {summary ? <span className="hidden text-muted-foreground sm:inline"> · {summary}</span> : null}
      </p>
      {upgrade ? (
        <UpgradeButton clientId={upgrade.clientId} planKey={upgrade.planKey} label={upgrade.label} className="h-7 px-2.5 text-xs" />
      ) : (
        <Link href="/portal/guidelines#plans" className="shrink-0 text-xs font-medium underline underline-offset-2">
          See plans
        </Link>
      )}
    </div>
  );
}
