import Link from "next/link";
import { Sun } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { BriefingCard } from "@/lib/daily-briefing";

/**
 * Today's morning briefing on the Overview. Reads the copy stored when the
 * briefing was emailed — no model call on page load. Renders nothing when
 * there's no briefing for today. (The on/off switch lives in the Overview's
 * "AI features" card and in Settings → Alerts.)
 */
export function DailyBriefingCard({ card }: { card: BriefingCard | null }) {
  if (!card) return null;
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="space-y-3 p-4 text-sm">
        <div className="flex items-start gap-3">
          <Sun className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <p className="font-medium">This morning&apos;s briefing</p>
            <p className="text-muted-foreground">{card.opening}</p>
          </div>
        </div>
        {card.callbacks.length ? (
          <ul className="space-y-1.5 pl-8">
            {card.callbacks.map((cb, i) => (
              <li key={i}>
                <span className="font-medium">
                  {cb.urgent ? "🚨 " : ""}
                  {cb.link ? (
                    <Link href={cb.link.replace(/^https?:\/\/[^/]+/, "")} className="underline underline-offset-2">
                      {cb.who}
                    </Link>
                  ) : (
                    cb.who
                  )}
                </span>{" "}
                <span className="text-muted-foreground">— {cb.what}</span>
                {cb.note ? <span className="block text-xs text-indigo-600 dark:text-indigo-400">{cb.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
