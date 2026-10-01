import Link from "next/link";
import { ChevronDown, Clock, Moon, Phone, PhoneOutgoing, Repeat } from "lucide-react";
import { Chip, InitialsAvatar, OUTCOME_TONE, SENTIMENT_CHIP } from "@/components/portal/visual";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime, formatDuration, formatPhone } from "@/lib/format";
import { CALL_OUTCOME_LABELS } from "@/config/options";
import type { Call } from "@/db/schema";
import { callerName, ordinal, otherParty, priorCalls, type CallerIndex } from "@/lib/callers";

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
  callers,
}: {
  clientId: string;
  calls: Call[];
  callHref?: (id: string) => string;
  timezone?: string;
  /** When given, rows show the caller's name and how many times they've called before. */
  callers?: CallerIndex;
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
    <ul className="fd-stagger space-y-2">
      {calls.map((c) => {
        const sentiment = c.sentiment ? SENTIMENT_CHIP[c.sentiment] : null;
        const hasBody = Boolean(c.summary || c.recordingUrl);
        const party = otherParty(c);
        const name = callers ? callerName(callers, party) : null;
        const before = callers ? priorCalls(callers, c) : 0;
        const phone = formatPhone(party);
        const title = name ?? (phone || (c.direction === "outbound" ? "them" : "Unknown caller"));
        const chips = (
          <>
            {c.outcome ? (
              <Chip tone={OUTCOME_TONE[c.outcome] ?? "slate"} dot>
                {CALL_OUTCOME_LABELS[c.outcome]}
              </Chip>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
            {sentiment ? (
              <Chip tone={sentiment.tone} icon={sentiment.icon} title={`Caller sentiment: ${sentiment.label}`}>
                {sentiment.label}
              </Chip>
            ) : null}
          </>
        );
        const header = (
          <>
            <InitialsAvatar name={name} seed={party ?? c.id} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                {c.direction === "outbound" ? (
                  <PhoneOutgoing className="size-3.5 shrink-0 text-muted-foreground" aria-label="AI called" />
                ) : null}
                <span className="truncate font-medium text-foreground">
                  {c.direction === "outbound" ? `AI called ${title}` : title}
                </span>
                {name && phone ? (
                  <span className="hidden shrink-0 text-muted-foreground sm:inline">{phone}</span>
                ) : null}
                {before > 0 ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand"
                    title={`This number has called ${before} time${before === 1 ? "" : "s"} before`}
                  >
                    <Repeat className="size-3" aria-hidden />
                    {ordinal(before + 1)} call
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
                <span className="tabular-nums">{formatDateTime(c.startAt, timezone)}</span>
                {c.durationSec != null ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
                    <Clock className="size-3" aria-hidden />
                    {formatDuration(c.durationSec)}
                  </span>
                ) : null}
                {c.isAfterHours ? (
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <Moon className="size-3" aria-hidden />
                    After hours
                  </span>
                ) : null}
              </span>
              {c.summary ? (
                <span className="mt-1 hidden truncate text-[13px] text-muted-foreground sm:block">
                  {c.summary}
                </span>
              ) : null}
              {/* Phones: the chips get their own line so the time never wraps. */}
              <span className="mt-1.5 flex flex-wrap gap-1.5 sm:hidden">{chips}</span>
            </span>
            <span className="hidden shrink-0 items-center gap-2 sm:flex">{chips}</span>
          </>
        );

        // A call with nothing to expand (no summary, no recording yet) links
        // straight to its detail page instead of opening an empty drawer.
        if (!hasBody) {
          return (
            <li key={c.id}>
              <Link
                href={hrefFor(c.id)}
                className="fd-row flex items-center gap-3 px-3.5 py-3 text-sm sm:px-4"
              >
                {header}
                <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground/60" aria-hidden />
              </Link>
            </li>
          );
        }

        return (
          <li key={c.id}>
            <details className="fd-row group">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3 text-sm sm:px-4 [&::-webkit-details-marker]:hidden">
                {header}
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  aria-hidden
                />
              </summary>
              <div className="space-y-3 border-t border-border/70 px-4 py-4 sm:pl-[4.25rem]">
                {c.summary ? (
                  <p className="text-sm leading-relaxed text-foreground/80">{c.summary}</p>
                ) : null}
                {c.recordingUrl ? (
                  <audio controls preload="none" src={c.recordingUrl} className="h-9 w-full" />
                ) : null}
                <p className="text-sm">
                  <Link
                    href={hrefFor(c.id)}
                    className="font-medium text-brand underline-offset-2 hover:underline"
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
