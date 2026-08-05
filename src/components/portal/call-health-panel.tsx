import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, PhoneOff, Repeat, ShieldAlert, UserRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDuration, formatPhone } from "@/lib/format";
import type { CallProblem, CallHealthSummary } from "@/lib/call-health";

export interface CallHealthItem {
  id: string;
  startAt: Date | string | null;
  fromNumber: string | null;
  durationSec: number | null;
  problems: CallProblem[];
  notes: string[];
}

const ICONS: Partial<Record<CallProblem, typeof UserRound>> = {
  stranded_asking_for_human: UserRound,
  repeated_question: Repeat,
  early_hangup: PhoneOff,
  possible_emergency: AlertTriangle,
  disclosure_missing: ShieldAlert,
  transferred_to_voicemail: PhoneOff,
};

export interface CallWaste {
  calls: number;
  seconds: number;
  spamCalls: number;
  spamSeconds: number;
}

/**
 * "What went wrong" — the half of the story the rest of this market leaves out.
 *
 * Competitors report calls answered and a sentiment score their own model
 * produced. This reports the calls that failed, says how, and links to the
 * recording so the owner can check us. It will sometimes make the product look
 * worse than a competitor's dashboard. That's the point: a business that finds
 * out from a customer instead of from us cancels, and every one of these is
 * something they'd otherwise find out from a customer.
 */
export function CallHealthPanel({
  summary,
  items,
  waste,
  medianReplyMs,
  latencySampleSize,
  blockList,
  timeZone,
}: {
  summary: CallHealthSummary;
  items: CallHealthItem[];
  waste?: CallWaste;
  /** Median time the AI took to start replying, or null if unknown. */
  medianReplyMs?: number | null;
  latencySampleSize?: number;
  /** Rendered under the spam line — blocking is the point of counting. */
  blockList?: ReactNode;
  timeZone?: string;
}) {
  if (summary.total === 0) return null;

  const problemCalls = summary.total - summary.clean;

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>What went wrong — last 30 days</CardTitle>
        <CardDescription>
          {problemCalls === 0
            ? `All ${summary.total} calls went cleanly. No one was left waiting, cut off, or asked the same thing twice.`
            : `${problemCalls} of ${summary.total} calls had something worth a look. Tap any one to hear it.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {problemCalls === 0 ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4 shrink-0" />
            Nothing needs your attention.
          </p>
        ) : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Asked for a person, didn't get one"
                value={summary.strandedAskingForHuman}
                tone={summary.strandedAskingForHuman > 0 ? "bad" : "ok"}
              />
              <Stat
                label="Had to be asked something 3+ times"
                value={summary.repeatedQuestion}
                tone={summary.repeatedQuestion > 0 ? "bad" : "ok"}
              />
              <Stat
                label="Hung up in the first 15 seconds"
                value={summary.earlyHangup}
                tone={summary.earlyHangup > 0 ? "warn" : "ok"}
              />
              <Stat
                label="Ended with no way to call back"
                value={summary.noContactCaptured}
                tone={summary.noContactCaptured > 0 ? "warn" : "ok"}
              />
            </dl>

            {summary.transferredToVoicemail > 0 ? (
              /* Found on the very first real call: the transfer "succeeded"
                 into a voicemail box. The caller heard a recorded greeting
                 mid-call, which is worse than never being offered a person. */
              <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <PhoneOff className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong>{summary.transferredToVoicemail}</strong>{" "}
                  {summary.transferredToVoicemail === 1 ? "transfer" : "transfers"} reached a
                  voicemail box instead of a person. Check that the number your AI transfers to is
                  one someone actually answers.
                </span>
              </p>
            ) : null}

            {summary.disclosureMissing > 0 ? (
              /* A business whose calls are transcribed by third-party vendors
                 without the caller being told is the fact pattern in the
                 California wiretapping suits — and it's the business that gets
                 named, not us. Cheap to fix, expensive to discover late. */
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  On <strong>{summary.disclosureMissing}</strong>{" "}
                  {summary.disclosureMissing === 1 ? "call" : "calls"}, your AI didn&apos;t give the
                  full disclosure — that it&apos;s an AI and that the call may be recorded. Both
                  matter if anyone ever asks. You can adjust the wording in Settings.
                </span>
              </p>
            ) : null}

            {summary.possibleEmergency > 0 ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <strong>{summary.possibleEmergency}</strong>{" "}
                  {summary.possibleEmergency === 1 ? "call" : "calls"} mentioned something that
                  might have been urgent. Worth listening to these first.
                </span>
              </p>
            ) : null}

            <ul className="divide-y rounded-lg border">
              {items.map((item) => {
                const lead = item.problems[0];
                const Icon = (lead && ICONS[lead]) ?? AlertTriangle;
                return (
                  <li key={item.id}>
                    <Link
                      href={`/portal/calls/${item.id}`}
                      className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">{item.notes[0]}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatPhone(item.fromNumber)} · {formatDateTime(item.startAt, timeZone)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {waste && waste.spamCalls > 0 ? (
          /* Every competitor bills for these and says nothing. The most-cited
             final straw in this market is a customer working out for themselves
             that most of their minutes were robocalls. */
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <strong className="text-foreground">
              {waste.spamCalls} spam {waste.spamCalls === 1 ? "call" : "calls"}
            </strong>{" "}
            reached your number this month — {formatDuration(waste.spamSeconds)} of them. Your AI
            handled these so you didn&apos;t have to, and they don&apos;t count toward anything you
            pay for.
          </p>
        ) : null}

        {blockList}

        {summary.unreadable > 0 ? (
          /* Never let an unreadable transcript round down to "fine". A clean
             report is only worth anything if we'd have said otherwise. */
          <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
            We couldn&apos;t read {summary.unreadable} {summary.unreadable === 1 ? "call" : "calls"}{" "}
            well enough to check {summary.unreadable === 1 ? "it" : "them"}, so{" "}
            {summary.unreadable === 1 ? "it isn't" : "they aren't"} counted either way. We&apos;re
            looking into it.
          </p>
        ) : null}

        {medianReplyMs != null && (latencySampleSize ?? 0) >= 3 ? (
          <p className="text-sm text-muted-foreground">
            Your AI started replying in{" "}
            <strong className="text-foreground">{(medianReplyMs / 1000).toFixed(1)}s</strong> on a
            typical turn. Under a second and a half feels like a conversation; past three, callers
            start talking over it.
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          These are counted from what was actually said on each call, not scored by an AI. Every
          one links to the recording so you can check us.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "bad" }) {
  return (
    <div className="rounded-lg border p-3">
      <dd
        className={
          tone === "bad"
            ? "font-heading text-2xl font-semibold text-destructive"
            : tone === "warn"
              ? "font-heading text-2xl font-semibold text-amber-600 dark:text-amber-400"
              : "font-heading text-2xl font-semibold text-muted-foreground"
        }
      >
        {value}
      </dd>
      <dt className="mt-0.5 text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
