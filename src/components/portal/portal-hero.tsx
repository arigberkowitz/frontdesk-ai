import Link from "next/link";
import { CalendarDays, MessagesSquare, PhoneCall, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HeroStatusTone } from "@/lib/portal-hero";

export interface HeroStat {
  label: string;
  value: number;
  href: string;
}

/**
 * The top of the Overview: a greeting in the business's own time of day, a
 * one-line status for the receptionist, today's numbers and the three things
 * an owner opens most. Presentational only; the page passes in data it
 * already loads.
 */
export function PortalHero({
  greeting,
  name,
  description,
  status,
  statusDetail,
  stats,
  appointmentsLabel,
  unreadMessages,
  children,
}: {
  greeting: string;
  name?: string | null;
  description: string;
  status: { tone: HeroStatusTone; label: string };
  statusDetail?: string | null;
  stats: HeroStat[];
  appointmentsLabel: string;
  unreadMessages: number;
  /** Top-right slot (live alerts toggle). */
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="overview-title"
      className="fd-hero-panel fd-fade-up relative isolate overflow-hidden rounded-2xl border bg-card p-5 sm:p-7"
    >
      {/* Decoration only: aurora mesh + fine grid (light portal skin). */}
      <div aria-hidden className="fd-hero-mesh" />
      <div aria-hidden className="fd-hero-grid" />

      <div className="flex items-start justify-between gap-3">
        <p className="fd-section-label">Overview</p>
        {children ? <div className="-mt-1 shrink-0">{children}</div> : null}
      </div>

      <h1
        id="overview-title"
        className="mt-2 font-heading text-[1.75rem] leading-tight font-semibold tracking-tight text-balance sm:text-4xl"
      >
        {greeting}
        {name ? (
          <>
            , <span className="fd-gradient-text">{name}</span>
          </>
        ) : null}
      </h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{description}</p>

      <div
        className="mt-4 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-2xl border bg-background/70 px-3 py-1.5 text-sm sm:rounded-full"
        role="status"
      >
        <span
          aria-hidden
          className={cn(
            status.tone === "live"
              ? "fd-live-dot"
              : cn("size-2 shrink-0 rounded-full", status.tone === "paused" ? "bg-amber-500" : "bg-brand"),
          )}
        />
        <span className="font-medium">{status.label}</span>
        {statusDetail ? (
          <span className="w-full pl-4 text-muted-foreground sm:w-auto sm:pl-0">
            <span className="hidden sm:inline">· </span>
            {statusDetail}
          </span>
        ) : null}
      </div>

      <div className="fd-stagger mt-6 grid grid-cols-3 gap-2 sm:max-w-xl sm:gap-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="fd-hero-stat fd-lift rounded-xl border bg-background/60 px-3 py-3 sm:px-4"
          >
            <span className="block font-heading text-2xl leading-none font-semibold tabular-nums sm:text-3xl">
              {s.value}
            </span>
            <span className="mt-1.5 block text-xs leading-snug font-medium text-muted-foreground">
              {s.label}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          size="lg"
          variant={unreadMessages > 0 ? "default" : "outline"}
          render={<Link href="/portal/messages" />}
          nativeButton={false}
          className="px-3.5"
        >
          <MessagesSquare className="size-4" />
          Messages
          {unreadMessages > 0 ? (
            <span className="rounded-full bg-white/20 px-1.5 text-xs tabular-nums">{unreadMessages}</span>
          ) : null}
        </Button>
        <Button
          size="lg"
          variant="outline"
          render={<Link href="/portal/appointments" />}
          nativeButton={false}
          className="px-3.5"
        >
          <CalendarDays className="size-4" />
          {appointmentsLabel}
        </Button>
        <Button
          size="lg"
          variant={unreadMessages > 0 ? "outline" : "default"}
          render={<Link href="/portal/guidelines#test-call" />}
          nativeButton={false}
          className="px-3.5"
        >
          {unreadMessages > 0 ? <PhoneCall className="size-4" /> : <Sparkles className="size-4" />}
          Test your AI
        </Button>
      </div>
    </section>
  );
}
