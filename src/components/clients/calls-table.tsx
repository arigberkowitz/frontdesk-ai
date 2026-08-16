import Link from "next/link";
import { ChevronDown, Moon, Phone, PhoneOutgoing } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime, formatDuration, formatPhone } from "@/lib/format";
import { CALL_OUTCOME_LABELS } from "@/config/options";
import { CHART_COLORS } from "@/components/charts/theme";
import type { Call, CallOutcome } from "@/db/schema";

// Same palette as the outcomes donut, so an outcome reads identically everywhere.
const OUTCOME_COLOR: Record<CallOutcome, string> = {
  booked: CHART_COLORS.booked,
  lead: CHART_COLORS.message,
  faq_answered: CHART_COLORS.answered,
  escalated: CHART_COLORS.escalated,
  spam: CHART_COLORS.other,
  missed: CHART_COLORS.missed,
  other: CHART_COLORS.other,
};

const SENTIMENT: Record<string, { label: string; dot: string }> = {
  positive: { label: "Happy caller", dot: "bg-emerald-500" },
  neutral: { label: "Neutral", dot: "bg-slate-400" },
  negative: { label: "Frustrated caller", dot: "bg-rose-500" },
};

/**
 * The call log, readable without leaving it.
 *
 * This was a four-column gray table where every row was a date and a phone
 * number, and finding out what actually HAPPENED on a call meant clicking
 * through to a detail page and back, once per call. Each row now expands in
 * place — the AI's one-line summary, the recording playable right there, and
 * the full transcript a link away. Rows stay scannable when closed: time,
 * caller, length, outcome, and how the caller felt.
 */
export function CallsTable({
  clientId,
  calls,
  callHref,
  timezone,
}: {
  clientId: string;
  calls: Call[];
  callHref?: (id: string) => string;
  timezone?: string;
}) {
  const hrefFor = callHref ?? ((id: string) => `/clients/${clientId}/calls/${id}`);
  if (!calls.length) {
    return (
      <EmptyState
        icon={Phone}
        title="No calls yet"
        description="Answered calls will appear here with transcripts and outcomes."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {calls.map((c) => {
        const sentiment = c.sentiment ? SENTIMENT[c.sentiment] : null;
        const hasBody = Boolean(c.summary || c.recordingUrl);
        const header = (
          <>
            <span className="min-w-0">
              <span className="font-medium">{formatDateTime(c.startAt, timezone)}</span>
              {c.isAfterHours ? (
                <Moon
                  className="ml-1.5 inline size-3.5 text-indigo-500/70"
                  aria-label="After hours"
                />
              ) : null}
              <span className="ml-2 hidden text-muted-foreground sm:inline">
                {c.direction === "outbound" ? (
                  <span className="inline-flex items-center gap-1">
                    <PhoneOutgoing className="size-3.5" aria-hidden />
                    AI called {formatPhone(c.toNumber) || "them"}
                  </span>
                ) : (
                  formatPhone(c.fromNumber) || "Unknown caller"
                )}
              </span>
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-2.5">
              <span className="hidden text-sm text-muted-foreground md:inline">
                {formatDuration(c.durationSec)}
              </span>
              {sentiment ? (
                <span
                  className="hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex"
                  title={sentiment.label}
                >
                  <span className={`size-2 rounded-full ${sentiment.dot}`} aria-hidden />
                  {sentiment.label}
                </span>
              ) : null}
              {c.outcome ? (
                <Badge variant="outline" className="gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: OUTCOME_COLOR[c.outcome] }}
                    aria-hidden="true"
                  />
                  {CALL_OUTCOME_LABELS[c.outcome]}
                </Badge>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </span>
          </>
        );

        // A call with nothing to expand (no summary, no recording yet) links
        // straight to its detail page instead of opening an empty drawer.
        if (!hasBody) {
          return (
            <li key={c.id}>
              <Link
                href={hrefFor(c.id)}
                className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/40"
              >
                {header}
                <ChevronDown className="size-4 -rotate-90 text-muted-foreground/60" aria-hidden />
              </Link>
            </li>
          );
        }

        return (
          <li key={c.id}>
            <details className="group rounded-xl border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                {header}
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="space-y-3 border-t px-4 py-4">
                {c.summary ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">{c.summary}</p>
                ) : null}
                {c.recordingUrl ? (
                  <audio controls preload="none" src={c.recordingUrl} className="h-9 w-full" />
                ) : null}
                <p className="text-sm">
                  <Link
                    href={hrefFor(c.id)}
                    className="font-medium underline underline-offset-2 hover:text-foreground"
                  >
                    Full transcript & details →
                  </Link>
                </p>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
