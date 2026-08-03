"use client";

import { useMemo, useState } from "react";
import { Phone } from "lucide-react";
import type { DayPoint } from "@/lib/data/metrics";
import type { FollowUpCall } from "@/lib/data/follow-ups";
import { CallsChart } from "@/components/charts/calls-chart";
import { OutcomesChart } from "@/components/charts/outcomes-chart";
import { LeadStatusControl } from "@/components/clients/lead-status-control";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/format";

/** Why an unbooked call didn't book — friendly label + a status dot from the chart palette. */
const REASON: Record<string, { label: string; dot: string }> = {
  lead: { label: "Left a message", dot: "#6366f1" },
  faq_answered: { label: "Just had a question", dot: "#3b82f6" },
  escalated: { label: "Transferred to you", dot: "#f59e0b" },
  missed: { label: "Missed — no answer", dot: "#94a3b8" },
  other: { label: "Didn't book", dot: "#cbd5e1" },
};

function reasonOf(outcome: string | null): { label: string; dot: string } {
  return (outcome && REASON[outcome]) || REASON.other;
}

function fmtTime(value: Date | string | null, tz?: string): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(d);
}

function fmtDayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

interface Props {
  trend: DayPoint[];
  outcomes: { outcome: string; count: number }[];
  followUps: FollowUpCall[];
  clientId: string;
  tz?: string;
}

/** Trend chart + outcomes donut + a "who called and why it didn't book" panel that
 *  the chart drives: tap a day, see that day's unbooked calls with numbers to call back. */
export function CallActivity({ trend, outcomes, followUps, clientId, tz }: Props) {
  const totalCalls = trend.reduce((n, d) => n + d.calls, 0);
  // Default to the most recent day that actually has someone to follow up with.
  const [selectedDate, setSelectedDate] = useState<string | null>(followUps[0]?.date ?? null);

  const dayItems = useMemo(
    () => followUps.filter((f) => f.date === selectedDate),
    [followUps, selectedDate],
  );
  const dayTrend = useMemo(
    () => trend.find((d) => d.date === selectedDate),
    [trend, selectedDate],
  );

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Calls and bookings — last 14 days</CardTitle>
          </CardHeader>
          <CardContent>
            <CallsChart data={trend} selectedDate={selectedDate} onSelectDay={setSelectedDate} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What happened on your calls</CardTitle>
          </CardHeader>
          <CardContent>
            <OutcomesChart data={outcomes} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Calls that didn&apos;t book</CardTitle>
          {selectedDate ? (
            <p className="text-sm text-muted-foreground">
              {fmtDayLabel(selectedDate)}
              {dayTrend
                ? ` · ${dayTrend.calls} call${dayTrend.calls === 1 ? "" : "s"}, ${dayTrend.bookings} booked`
                : ""}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tap a day on the chart to see who called and why it didn&apos;t turn into a booking.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {followUps.length === 0 ? (
            /* "Every call either booked or was fully handled" is a claim about
               calls. With no calls it's a claim about nothing, and it read as
               praise to businesses whose phone had never rung. */
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {totalCalls === 0
                ? "No calls yet — this fills in with anyone worth calling back."
                : "Nothing to follow up on — every call either booked or was fully handled."}
            </p>
          ) : dayItems.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No unbooked calls on {selectedDate ? fmtDayLabel(selectedDate) : "this day"}. Pick a day with
              activity to see who to call back.
            </p>
          ) : (
            <ul className="divide-y">
              {dayItems.map((f) => {
                const r = reasonOf(f.outcome);
                const canCall = f.phone && formatPhone(f.phone) !== "—";
                return (
                  <li key={f.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: r.dot }}
                            aria-hidden="true"
                          />
                          {r.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {fmtTime(f.startAt, tz)}
                          {f.isAfterHours ? " · after hours" : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">
                        {f.name ?? "Caller"}
                        {canCall ? (
                          <>
                            {" · "}
                            <a
                              href={`tel:${(f.phone ?? "").replace(/[^\d+]/g, "")}`}
                              className="underline underline-offset-2 hover:text-foreground"
                            >
                              {formatPhone(f.phone)}
                            </a>
                          </>
                        ) : null}
                      </p>
                      {f.summary ? (
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{f.summary}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0">
                      {f.leadId ? (
                        <LeadStatusControl
                          leadId={f.leadId}
                          clientId={clientId}
                          status={f.leadStatus ?? "new"}
                        />
                      ) : canCall ? (
                        <Button
                          render={<a href={`tel:${(f.phone ?? "").replace(/[^\d+]/g, "")}`} />}
                          nativeButton={false}
                          variant="outline"
                          size="sm"
                        >
                          <Phone className="size-3.5" />
                          Call back
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
