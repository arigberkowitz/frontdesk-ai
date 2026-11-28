import Link from "next/link";
import { Lock, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/panel-header";
import { formatCurrencyCents } from "@/lib/format";
import { PLANS } from "@/config/plans";

/** Where "Upgrade to Pro" goes: the plan card in Settings, which switches plans in place. */
export const UPGRADE_HREF = "/portal/settings#plan";

export interface LockedTeaser {
  line: string;
  detail: string | null;
  preview: string;
}

/**
 * A Pro feature shown to a business on Missed-Call Rescue or Starter: what it
 * would have done for them (their own numbers, or a plain line when there
 * aren't any), the exact text a customer would get, and one button.
 */
export function ProLockedCard({
  icon,
  title,
  teaser,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  teaser: LockedTeaser;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={icon}
          title={
            <span className="flex items-center gap-2">
              {title}
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-700">
                <Lock className="size-3" /> Pro
              </span>
            </span>
          }
        />
        <div className="mt-4 space-y-1.5 sm:ml-12">
          <p className="text-sm font-medium">{teaser.line}</p>
          {teaser.detail ? <p className="text-sm text-muted-foreground">{teaser.detail}</p> : null}
        </div>
        <figure className="mt-4 sm:ml-12">
          <figcaption className="mb-1.5 text-xs text-muted-foreground">The text a customer would get:</figcaption>
          <blockquote className="max-w-md rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed">
            {teaser.preview}
          </blockquote>
        </figure>
        <div className="mt-5 flex flex-wrap items-center gap-3 sm:ml-12">
          <Button size="sm" render={<Link href={UPGRADE_HREF} />} nativeButton={false}>
            Upgrade to Pro
          </Button>
          <p className="text-xs text-muted-foreground">
            Pro is {formatCurrencyCents(PLANS.pro.monthlyPriceCents)}/mo, one flat monthly price. Switch any time.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
