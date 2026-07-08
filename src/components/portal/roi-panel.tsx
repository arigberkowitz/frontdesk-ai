import { TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CountUp } from "@/components/count-up";
import { formatCurrencyCents } from "@/lib/format";
import type { ClientRoi } from "@/lib/data/metrics";

/** "What your AI did this month" — value captured vs. plan cost, with a plain-English
 *  takeaway. Degrades to an activity-led message when there are no bookings yet. The
 *  supporting stat breakdown lives in the metric cards just below, so it isn't repeated here. */
export function RoiPanel({ roi }: { roi: ClientRoi }) {
  const { valueCents, planCents, multiple, calls, afterHours } = roi;
  const hasValue = valueCents > 0;
  // Only claim a multiple when the value is clearly above the plan cost.
  const showMultiple = multiple != null && multiple >= 1.5;

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-medium text-muted-foreground">
            What your AI did in the last 30 days
          </span>
        </div>

        {hasValue ? (
          <>
            <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-heading text-4xl font-semibold leading-none tracking-tight text-emerald-600 dark:text-emerald-400">
                <CountUp value={formatCurrencyCents(valueCents)} />
              </span>
              <span className="text-sm text-muted-foreground">
                booked
                {planCents != null ? ` — while your plan costs ${formatCurrencyCents(planCents)}` : ""}
              </span>
            </div>
            {showMultiple ? (
              <p className="mt-2 text-sm">
                Your AI brought in about{" "}
                <strong>{Math.round(multiple as number)}× what you pay</strong> this month.
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="mt-2.5 font-heading text-2xl font-semibold tracking-tight">
              Your AI is on the job
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              It answered {calls} call{calls === 1 ? "" : "s"}
              {afterHours > 0 ? ` and caught ${afterHours} after-hours` : ""} in the last 30 days.
              Bookings show their dollar value here as they come in.
            </p>
          </>
        )}

        <p className="mt-4 text-xs text-muted-foreground">
          &ldquo;Booked&rdquo; = appointments your AI scheduled × your average service price.
        </p>
      </CardContent>
    </Card>
  );
}
