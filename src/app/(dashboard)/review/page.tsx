import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { listOpenGradesForOrg } from "@/lib/data/grades";
import { markGradeReviewedAction } from "@/lib/actions/grades";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Review" };

function scoreChip(score: number): string {
  if (score <= 2) return "bg-red-500/10 text-red-600 dark:text-red-400";
  if (score === 3) return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
}

function flagLabel(flag: string): string {
  return flag.replaceAll("_", " ");
}

/** Operator review queue — the QA supervisor's flagged calls, worst first. */
export default async function ReviewPage() {
  const user = await requireOperator();
  const items = await listOpenGradesForOrg(user.orgId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review queue"
        description="Calls the QA agent flagged for a look — coach the AI, then clear them."
      />

      {items.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={ShieldCheck}
              title="Queue is clear"
              description="The QA agent grades every call overnight; anything worth your attention lands here."
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="fd-stagger divide-y rounded-xl border bg-card">
          {items.map(({ grade, call, client }) => {
            const flags = ((grade.flags as string[] | null) ?? []).filter(
              (f) => f !== "compliance_risk",
            );
            return (
              <li key={grade.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                          scoreChip(grade.score),
                        )}
                      >
                        {grade.score}/5
                      </span>
                      <span className="text-sm font-medium">{client.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {call.startAt ? formatDateTime(call.startAt, client.timezone) : "—"}
                      </span>
                      {grade.complianceRisk ? (
                        <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">
                          compliance risk
                        </span>
                      ) : null}
                      {flags.map((f) => (
                        <span
                          key={f}
                          className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
                        >
                          {flagLabel(f)}
                        </span>
                      ))}
                    </div>
                    {grade.coachingNote ? (
                      <p className="mt-2 text-sm text-muted-foreground">{grade.coachingNote}</p>
                    ) : null}
                    {call.summary ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {call.summary}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={`/clients/${client.id}/calls/${call.id}`} />}
                    >
                      View call
                      <ArrowRight className="size-3.5" />
                    </Button>
                    <form action={markGradeReviewedAction}>
                      <input type="hidden" name="gradeId" value={grade.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        <Check className="size-3.5" />
                        Reviewed
                      </Button>
                    </form>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
