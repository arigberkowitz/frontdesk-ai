import Link from "next/link";
import { MessageSquareReply } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "@/components/panel-header";
import {
  comparisonHeadline,
  MIN_SAMPLE_PER_CHANNEL,
  PICKUP_MIN_SECONDS,
  type ChannelStats,
  type FollowUpComparison,
} from "@/lib/followup-channels";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ChannelColumn({
  label,
  unit,
  stats,
  respondedLabel,
  highlight,
}: {
  label: string;
  unit: [string, string, string];
  stats: ChannelStats;
  respondedLabel: string;
  highlight: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${highlight ? "border-emerald-500/40 bg-emerald-500/5" : "bg-muted/30"}`}
    >
      <p className="fd-section-label">{label}</p>
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">
        {plural(stats.sent, unit[0], unit[1])} {unit[2]}
      </p>
      {stats.enough ? (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-xs text-muted-foreground">{respondedLabel}</dt>
            <dd className="mt-1 font-heading text-2xl font-semibold leading-none tabular-nums">
              {stats.respondedPct}%
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground tabular-nums">
              {stats.responded} of {stats.sent}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Booked</dt>
            <dd className="mt-1 font-heading text-2xl font-semibold leading-none tabular-nums">
              {stats.bookedPct}%
            </dd>
            <dd className="mt-1 text-xs text-muted-foreground tabular-nums">
              {stats.booked} of {stats.sent}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Not enough data yet. Rates show after {MIN_SAMPLE_PER_CHANNEL}.
        </p>
      )}
    </div>
  );
}

/**
 * "Text back or call back?" — for callers who hung up or got cut off, how many
 * responded and booked after a text back vs an AI call back. Real counts only;
 * a channel under the minimum sample shows "not enough data yet", never a rate.
 */
export function FollowUpChannels({ data }: { data: FollowUpComparison }) {
  const { text, call, days, windowDays, leader } = data;
  return (
    <Card id="text-vs-call">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={MessageSquareReply}
          title="Text back or call back?"
          description={`Callers who hung up or got cut off, and what happened after your follow-up. Last ${days} days.`}
        />

        <p className="mt-4 text-sm">{comparisonHeadline(data)}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ChannelColumn
            label="Text back"
            unit={["text", "texts", "sent"]}
            stats={text}
            respondedLabel="Responded"
            highlight={leader === "text"}
          />
          <ChannelColumn
            label="AI call back"
            unit={["call", "calls", "made"]}
            stats={call}
            respondedLabel="Responded"
            highlight={leader === "call"}
          />
        </div>

        {call.sent === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            No AI call backs went out in the last {days} days. You can turn them on in{" "}
            <Link href="/portal/settings/follow-ups" className="font-medium text-indigo-700 underline underline-offset-2">
              Settings → Follow-ups
            </Link>
            .
          </p>
        ) : null}

        <p className="mt-3 text-xs text-muted-foreground">
          Booked means an appointment for that caller&apos;s number was made within {windowDays} days
          of the follow-up and wasn&apos;t cancelled or a no-show. Responded means they texted back or called
          within {windowDays} days, or picked up the AI&apos;s call for at least {PICKUP_MIN_SECONDS} seconds. Calls you
          return from your own phone aren&apos;t tracked.
        </p>
      </CardContent>
    </Card>
  );
}
