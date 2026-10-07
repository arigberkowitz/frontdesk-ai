import Link from "next/link";
import { ArrowUpRight, MessageSquareText, MoonStar, PhoneIncoming } from "lucide-react";
import type { Client } from "@/db/schema";
import { getMonthValue } from "@/lib/data/month-value";
import { buildValueCard, type ValueCardView, type ValueStat } from "@/lib/month-value";
import { vocabFor } from "@/lib/vocab";
import { cn } from "@/lib/utils";

/**
 * Overview hero: "Frontdesk booked you $X this month", plus after-hours calls
 * answered, missed calls won back by text-back, and texts the AI handled —
 * all for the business's own calendar month. Loads its own numbers so it can
 * stream in behind <Suspense> without holding up the rest of the page.
 */
export async function ValueCardSection({ client }: { client: Client }) {
  const stats = await getMonthValue(client.id, client.timezone);
  const v = vocabFor(client.industry);
  const view = buildValueCard(stats, {
    timeZone: client.timezone,
    appointmentWord: { one: v.appointment, many: v.appointments },
    missedCallTextsEnabled: client.missedCallTextsEnabled,
    aiTextRepliesEnabled: client.aiTextRepliesEnabled,
  });
  return <ValueCard view={view} />;
}

const ICONS: Record<ValueStat["key"], typeof MoonStar> = {
  afterHours: MoonStar,
  recovered: PhoneIncoming,
  aiTexts: MessageSquareText,
};

export function ValueCard({ view }: { view: ValueCardView }) {
  return (
    <section
      aria-labelledby="value-card-title"
      className="fd-hero-panel relative isolate overflow-hidden rounded-2xl border bg-card p-5 sm:p-6"
      data-testid="value-card"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:items-center lg:gap-6">
        <div className="min-w-0">
          <p className="fd-section-label">This month · {view.monthLabel}</p>
          <h2 id="value-card-title" className="mt-2">
            <span className="sr-only">{view.headline}</span>
            <span aria-hidden className="block text-sm font-medium text-muted-foreground">
              {view.lead}
            </span>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 block font-heading text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl",
                view.amount && view.amount !== "$0"
                  ? "bg-gradient-to-r from-[#6a3df5] to-[#0e7490] bg-clip-text text-transparent"
                  : "text-foreground/80",
              )}
            >
              {view.amount ?? "—"}
            </span>
            {view.trail ? (
              <span aria-hidden className="mt-0.5 block text-sm font-medium text-muted-foreground">
                {view.trail}
              </span>
            ) : null}
          </h2>
          {view.amount == null ? <p className="mt-2 text-sm text-muted-foreground">{view.headline}</p> : null}
          {view.notes.length ? (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {view.notes.map((n) => (
                <li key={n.text}>
                  {n.text}
                  {n.href ? (
                    <>
                      {" "}
                      <Link href={n.href} className="font-medium text-foreground underline underline-offset-2">
                        {n.linkText}
                      </Link>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {view.stats.map((s) => {
            const Icon = ICONS[s.key];
            return (
              <li key={s.key} className="min-w-0">
                <Link
                  href={s.href}
                  className="fd-lift fd-glass group grid h-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-xl border border-border/70 bg-card/70 p-3.5 sm:flex sm:flex-col sm:p-4"
                >
                  {/* Phones: one compact row per stat (number left, words right).
                      sm+: a tile with the number on top. */}
                  <span className="flex items-center justify-between gap-2 max-sm:hidden sm:w-full">
                    <span
                      className={cn(
                        "flex size-7 items-center justify-center rounded-lg",
                        s.off ? "bg-muted text-muted-foreground" : "bg-indigo-500/10 text-indigo-600",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                  <span
                    className={cn(
                      "row-span-2 min-w-[2.75rem] font-heading font-semibold tracking-tight tabular-nums sm:mt-3 sm:min-w-0",
                      s.off ? "pt-0.5 text-lg text-muted-foreground sm:text-xl" : "text-3xl",
                    )}
                  >
                    {s.value}
                  </span>
                  <span className="text-sm font-medium sm:mt-0.5">{s.label}</span>
                  <span className="col-start-2 mt-0.5 text-xs text-muted-foreground sm:mt-1">{s.caption}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Same footprint while the month's numbers load. */
export function ValueCardSkeleton() {
  return <div aria-hidden className="h-[30rem] animate-pulse rounded-2xl border bg-card/60 sm:h-64 lg:h-56" />;
}
