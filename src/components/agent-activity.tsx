import Link from "next/link";
import { ArrowRight, Bot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { AgentActivity } from "@/lib/data/agent-runs";

/**
 * "While you were out" — what the agent fleet did in the last 48h. Reads the
 * agent_runs audit trail; renders nothing until the first run exists.
 */
export function AgentActivityPanel({
  activity,
  openReviews,
}: {
  activity: AgentActivity;
  openReviews: number;
}) {
  if (activity.runs.length === 0) return null;

  const lines: { text: string; href?: string }[] = [];
  if (activity.qaGraded > 0) {
    lines.push({
      text: `QA graded ${activity.qaGraded} call${activity.qaGraded === 1 ? "" : "s"} — ${activity.qaFlagged} flagged`,
      href: openReviews > 0 ? "/review" : undefined,
    });
  }
  if (activity.callsReviewed > 0 || activity.improveKept > 0) {
    lines.push({
      text: `Improvement loop read ${activity.callsReviewed} transcript${activity.callsReviewed === 1 ? "" : "s"} and proposed ${activity.improveKept} fix${activity.improveKept === 1 ? "" : "es"} for owner approval`,
    });
  }
  if (activity.recoverySent > 0) {
    lines.push({
      text: `Recovery texted ${activity.recoverySent} cold lead${activity.recoverySent === 1 ? "" : "s"} / no-show${activity.recoverySent === 1 ? "" : "s"}`,
    });
  }
  if (activity.failures > 0) {
    lines.push({ text: `${activity.failures} run${activity.failures === 1 ? "" : "s"} failed — check logs` });
  }
  if (lines.length === 0) {
    lines.push({ text: "Agents ran — no changes needed. Quiet night." });
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Bot className="size-4" />
            </span>
            <p className="font-heading text-lg font-semibold tracking-tight">While you were out</p>
          </div>
          {openReviews > 0 ? (
            <Link
              href="/review"
              className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {openReviews} awaiting review
              <ArrowRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
        <ul className="mt-3 space-y-1.5">
          {lines.map((l) => (
            <li key={l.text} className="flex items-baseline gap-2 text-sm text-muted-foreground">
              <span aria-hidden className="text-indigo-500/60">•</span>
              {l.href ? (
                <Link href={l.href} className="hover:text-foreground hover:underline">
                  {l.text}
                </Link>
              ) : (
                l.text
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
