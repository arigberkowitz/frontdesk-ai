import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, BellRing, Inbox, MessagesSquare, Sparkles, Users } from "lucide-react";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientMetrics, getClientRoi, getClientWeeklyRecap } from "@/lib/data/metrics";
import { getClientSetupStatus } from "@/lib/data/setup";
import { getClientActivity } from "@/lib/data/activity";
import { listOpenSuggestions } from "@/lib/data/suggestions";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listAppointments } from "@/lib/data/appointments";
import { getCallHealth, listCalls } from "@/lib/data/calls";
import { getFollowUpsForClient } from "@/lib/data/follow-ups";
import { failedTextsSince } from "@/lib/data/reminders";
import { getTrialState } from "@/lib/data/trial";
import { listProviders } from "@/lib/data/providers";
import { countUnreadMessages } from "@/lib/data/sms-messages";
import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { CallActivity } from "@/components/portal/call-activity";
import { CallHealthPanel } from "@/components/portal/call-health-panel";
import { BlockedCallers } from "@/components/portal/blocked-callers";
import { TextingBrokenBanner } from "@/components/portal/texting-broken-banner";
import { TrialBanner } from "@/components/portal/trial-banner";
import { RoiPanel } from "@/components/portal/roi-panel";
import { SetupChecklist } from "@/components/portal/setup-checklist";
import { WeeklyRecap } from "@/components/portal/weekly-recap";
import { ActivityFeed } from "@/components/portal/activity-feed";
import { AiLearnings } from "@/components/portal/ai-learnings";
import { CopilotChat } from "@/components/portal/copilot-chat";
import { LiveAlerts } from "@/components/portal/live-alerts";
import { Milestones } from "@/components/portal/milestones";
import { formatCurrencyCents, formatDateTime } from "@/lib/format";
import { weekOverWeek } from "@/lib/trend";
import { capVocab, vocabFor } from "@/lib/vocab";

export const metadata: Metadata = { title: "Overview" };

export default async function PortalOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ onboarded?: string }>;
}) {
  const { onboarded } = await searchParams;
  const { clientId } = await resolvePortalClient();
  const [client, m, appts, callsList, followUps, roi, setup, recap, activity, learnings, team, health, failedTexts, trial, unreadMessages, editAccess] =
    await Promise.all([
      getClientByIdUnsafe(clientId),
      getClientMetrics(clientId),
      listAppointments(clientId),
      listCalls(clientId),
      getFollowUpsForClient(clientId),
      getClientRoi(clientId),
      getClientSetupStatus(clientId),
      getClientWeeklyRecap(clientId),
      getClientActivity(clientId),
      listOpenSuggestions(clientId),
      listProviders(clientId).catch(() => []),
      getCallHealth(clientId),
      failedTextsSince(clientId),
      getTrialState(clientId),
      // Never throws (0 until the sms_messages migration has run).
      countUnreadMessages(clientId),
      getPortalEditAccess(clientId),
    ]);
  const tz = client?.timezone;
  const v = vocabFor(client?.industry);
  const showTeamNudge = Boolean(client?.staffModeEnabled) && team.length === 0;
  const afterHours = callsList.filter((c) => c.isAfterHours && c.startAt);

  // The tile shows earned revenue — completed appointments only. This
  // breakdown used to render "bookings × avg price = total" with numbers that
  // essentially never multiplied to the total, because the left side counted
  // future appointments and the right side counted finished ones. A visible
  // equation that doesn't hold poisons trust in every other number on the page.
  const revenueBreakdown = [
    `What your AI's ${v.appointments} have earned — counted when the appointment happens, not when it's booked.`,
    ...(m.completedBookings > 0
      ? [`${formatCurrencyCents(m.estRevenueCents)} from ${m.completedBookings} completed ${m.completedBookings === 1 ? v.appointment : v.appointments}`]
      : [`Nothing completed yet.`]),
    ...(m.upcomingBookings > 0
      ? [`Plus ${formatCurrencyCents(m.upcomingRevenueCents)} booked and coming up (${m.upcomingBookings} ${m.upcomingBookings === 1 ? v.appointment : v.appointments})`]
      : []),
  ];
  // Per-call outcomes, from the calls themselves. The old version subtracted
  // the APPOINTMENTS table from the calls count, so three walk-ins added by
  // hand made "got a question answered" go negative-then-clamped — the tile
  // and its own breakdown disagreed.
  const outcomeCount = (key: string) => m.outcomes.find((o) => o.outcome === key)?.count ?? 0;
  const callsBreakdown = [
    "Every call your AI answered, by what happened on it.",
    `${outcomeCount("booked")} booked ${/^[aeiou]/.test(v.appointment) ? "an" : "a"} ${v.appointment}`,
    `${outcomeCount("lead")} left a message`,
    `${outcomeCount("faq_answered")} got a question answered`,
    ...(outcomeCount("escalated") > 0 ? [`${outcomeCount("escalated")} reached a person`] : []),
    ...(outcomeCount("spam") > 0 ? [`${outcomeCount("spam")} were spam`] : []),
  ];
  // Match the tile's number: cancelled / no-show bookings don't count there,
  // so they don't belong in its breakdown list either.
  const activeAppts = appts.filter((a) => a.status !== "cancelled" && a.status !== "no_show");
  const apptBreakdown = [
    `The ${v.appointments} your AI put on the calendar.`,
    ...(activeAppts.length
      ? activeAppts
          .slice(0, 4)
          .map((a) => `${a.customerName ?? "Caller"} — ${formatDateTime(a.startAt, tz)}`)
      : [`No ${v.appointments} yet.`]),
  ];
  const afterHoursBreakdown = [
    "Calls your AI caught outside your open hours — ones you'd likely have missed.",
    ...(afterHours.length
      ? afterHours.slice(0, 4).map((c) => `Call at ${formatDateTime(c.startAt, tz)}`)
      : ["None yet — your AI caught everything during open hours."]),
  ];

  // Each tile's line is its own number over the last 14 days — revenue is
  // money earned per day, not the bookings count in a green coat — with a
  // hover label per point and an honest week-over-week verdict underneath.
  const dayLabel = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const series = {
    revenue: m.callsByDay.map((d) => d.revenueCents),
    calls: m.callsByDay.map((d) => d.calls),
    bookings: m.callsByDay.map((d) => d.bookings),
    afterHours: m.callsByDay.map((d) => d.afterHours),
  };
  const labelsFor = (key: keyof typeof series, unit: (n: number) => string) =>
    m.callsByDay.map((d, i) => `${dayLabel(d.date)} · ${unit(series[key][i])}`);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const trend = {
    revenue: weekOverWeek(series.revenue, formatCurrencyCents),
    calls: weekOverWeek(series.calls),
    bookings: weekOverWeek(series.bookings),
    afterHours: weekOverWeek(series.afterHours),
  };

  // Things that want a decision from the owner, gathered in one place instead
  // of scattered between the numbers and the charts. Call health joins them
  // only when there's actually a call that went wrong.
  const healthNeedsYou = m.totalCalls > 0 && health.needsAttention.length > 0;
  const hasAttention =
    m.newLeads > 0 ||
    unreadMessages > 0 ||
    showTeamNudge ||
    (m.totalCalls > 0 && learnings.length > 0) ||
    healthNeedsYou;

  const callHealth = (
    <CallHealthPanel
      summary={health.summary}
      items={health.needsAttention}
      waste={health.waste}
      medianReplyMs={health.medianReplyMs}
      latencySampleSize={health.latencySampleSize}
      blockList={
        <BlockedCallers
          clientId={clientId}
          blocked={health.blockedNumbers}
          suggested={health.suggestedBlocks}
          timeZone={tz}
        />
      }
      timeZone={tz}
    />
  );

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageHeader
          title="Overview"
          description="What your AI receptionist caught for you. Tap any number for the details."
        >
          <LiveAlerts />
        </PageHeader>

        <TrialBanner state={trial} />

        <TextingBrokenBanner
          count={failedTexts.count}
          ourFault={/Twilio 20003|Authenticate/i.test(failedTexts.latestError ?? "")}
        />

        {onboarded ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-start gap-3 p-4 text-sm">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                {/* Two different things happen here and they used to say the same
                    sentence. Telling someone we read their website when we
                    couldn't — or when they never gave us one — makes every
                    number on the next screen look like it came from their
                    business, and it didn't. */}
                <p className="font-medium">
                  {onboarded === "website"
                    ? "We drafted your receptionist from your website."
                    : "We've started you off with a template for your industry."}
                </p>
                <p className="text-muted-foreground">
                  {onboarded === "website" ? null : (
                    <>
                      The services, hours and answers below are examples, not yours yet —{" "}
                      <strong>the prices especially</strong>.{" "}
                    </>
                  )}
                  Review your <strong>Services</strong>, <strong>Hours</strong>, and{" "}
                  <strong>Knowledge</strong> pages, set the greeting and voice under{" "}
                  <strong>Your AI</strong>, then activate it. Edit anything that&apos;s off —
                  nothing goes live until you activate.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Setup first while it's unfinished — it's the one thing a new owner
          has to do. It removes itself once done (or hidden), leaving the
          numbers at the top for everyone else. */}
      <SetupChecklist
        clientId={clientId}
        status={{ ...setup, finishedAt: setup.finishedAt?.toISOString() ?? null }}
        canEdit={editAccess.canEdit}
      />

      {/* The tiles stay even at zero — they're the promise, the picture of
          where the money will show up once the phone rings. */}
      <div className="fd-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard icon="revenue" label="Revenue captured" value={formatCurrencyCents(m.estRevenueCents)} href="/portal/appointments" breakdown={revenueBreakdown} spark={series.revenue} sparkLabels={labelsFor("revenue", formatCurrencyCents)} trend={trend.revenue} sparkColor="#10b981" size="hero" className="sm:col-span-2" />
        <MetricCard icon="calls" label="Calls answered" value={String(m.totalCalls)} href="/portal/calls" breakdown={callsBreakdown} spark={series.calls} sparkLabels={labelsFor("calls", (n) => plural(n, "call", "calls"))} trend={trend.calls} sparkColor="#0ea5e9" />
        <MetricCard icon="bookings" label={`${capVocab(v.appointments)} booked`} value={String(m.bookings)} href="/portal/appointments" breakdown={apptBreakdown} spark={series.bookings} sparkLabels={labelsFor("bookings", (n) => plural(n, v.appointment, v.appointments))} trend={trend.bookings} sparkColor="#10b981" />
        <MetricCard icon="afterHours" label="After-hours saves" value={String(m.afterHoursCalls)} href="/portal/calls" breakdown={afterHoursBreakdown} spark={series.afterHours} sparkLabels={labelsFor("afterHours", (n) => plural(n, "after-hours call", "after-hours calls"))} trend={trend.afterHours} sparkColor="#f59e0b" className="sm:col-span-2 lg:col-span-1" />
      </div>

      {hasAttention ? (
        <section className="space-y-3" aria-labelledby="needs-you">
          <h2 id="needs-you" className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <BellRing className="size-4" />
            Needs your attention
          </h2>
          {m.newLeads > 0 || unreadMessages > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {m.newLeads > 0 ? (
                <AttentionLink
                  href="/portal/leads"
                  icon={<Inbox className="size-5 text-amber-600 dark:text-amber-400" />}
                  tone="amber"
                  title={`${m.newLeads} new lead${m.newLeads === 1 ? "" : "s"}`}
                  detail="Callers who left a message your AI couldn't book."
                />
              ) : null}
              {unreadMessages > 0 ? (
                <AttentionLink
                  href="/portal/messages"
                  icon={<MessagesSquare className="size-5 text-indigo-600 dark:text-indigo-400" />}
                  tone="indigo"
                  title={`${unreadMessages} unread text${unreadMessages === 1 ? "" : "s"}`}
                  detail="Customers texted back. Reply from Messages."
                />
              ) : null}
            </div>
          ) : null}
          {showTeamNudge ? (
            <Card className="border-indigo-500/30 bg-indigo-500/5">
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <Users className="mt-0.5 size-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                <p className="text-muted-foreground">
                  <Link
                    href="/portal/staff"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Add your staff
                  </Link>{" "}
                  — so callers can book with a specific person.
                </p>
              </CardContent>
            </Card>
          ) : null}
          {m.totalCalls > 0 ? (
            <AiLearnings clientId={clientId} suggestions={learnings} canEdit={editAccess.canEdit} />
          ) : null}
          {/* A business should meet the calls that went wrong before it meets
              the ones that went right. */}
          {healthNeedsYou ? callHealth : null}
        </section>
      ) : null}

      {m.totalCalls === 0 ? (
        <Card>
          <CardContent className="py-5 text-sm text-muted-foreground">
            These fill in from your first call — every conversation adds to them, and each one comes
            with a recording and a summary so you can hear exactly what your AI said.
          </CardContent>
        </Card>
      ) : (
        <>
          <ActivityFeed items={activity} />

          {/* The deeper numbers are still one click away, but no longer stack
              five panels between the owner and the bottom of the page. */}
          <details className="group rounded-xl border bg-card">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm [&::-webkit-details-marker]:hidden">
              <BarChart3 className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium">Reports &amp; trends</span>
              <span className="hidden text-muted-foreground sm:inline">
                What your AI earned you, this week vs last, milestones{healthNeedsYou ? "" : ", call health"} and call patterns.
              </span>
              <span className="ml-auto shrink-0 text-xs font-medium underline underline-offset-2 group-open:hidden">
                Show
              </span>
              <span className="ml-auto hidden shrink-0 text-xs font-medium underline underline-offset-2 group-open:inline">
                Hide
              </span>
            </summary>
            <div className="space-y-6 border-t p-4">
              <RoiPanel roi={roi} />
              <WeeklyRecap recap={recap} />
              <Milestones totalCalls={m.totalCalls} estRevenueCents={m.estRevenueCents} />
              {healthNeedsYou ? null : callHealth}
              <CallActivity
                trend={m.callsByDay}
                outcomes={m.outcomes}
                followUps={followUps}
                clientId={clientId}
                tz={tz}
              />
            </div>
          </details>
        </>
      )}

      <CopilotChat />
    </div>
  );
}

/** One tappable "this wants you" tile on the Overview. */
function AttentionLink({
  href,
  icon,
  tone,
  title,
  detail,
}: {
  href: string;
  icon: React.ReactNode;
  tone: "amber" | "indigo";
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className={
        tone === "amber"
          ? "fd-lift flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm"
          : "fd-lift flex items-start gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 text-sm"
      }
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className="block font-medium">{title} →</span>
        <span className="text-muted-foreground">{detail}</span>
      </span>
    </Link>
  );
}
