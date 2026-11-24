import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "@/components/panel-header";
import { gapActionHref, type GapSummary } from "@/lib/knowledge-gaps";

// Kept here too so existing imports keep working; the email uses the same links.
export { gapActionHref };

/**
 * "Questions your AI couldn't answer" — how often a caller asks something the
 * knowledge base doesn't cover, and which questions. Real counts only: no data
 * reads as "nothing yet", never as a zero we didn't measure.
 */
export function UnansweredQuestions({
  summary,
  days = 30,
}: {
  summary: GapSummary;
  days?: number;
}) {
  const { checked, withGap, percent, top } = summary;
  return (
    <Card id="unanswered-questions">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={CircleHelp}
          title="Questions your AI couldn't answer"
          description="When a caller asks something that isn't in your knowledge base, your AI takes a message instead of guessing. Here's how often that happened."
        />

        {checked === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing to show yet. Once calls come in, you&apos;ll see how often callers ask something
            your AI doesn&apos;t have an answer for.
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm">
              Calls with a question it couldn&apos;t answer:{" "}
              <span className="font-semibold tabular-nums">
                {withGap} of {checked}
              </span>{" "}
              <span className="text-muted-foreground tabular-nums">({percent}%)</span> in the last{" "}
              {days} days
            </p>

            {withGap === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Your AI had an answer for every question on those calls.
              </p>
            ) : (
              <>
                <p className="mt-4 fd-section-label">Most asked</p>
                <ul className="mt-1">
                  {top.map((g) => (
                    <li
                      key={g.question}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t py-2.5 text-sm first:border-t-0"
                    >
                      <span className="min-w-0 flex-1">
                        {g.question}{" "}
                        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                          · {g.calls} {g.calls === 1 ? "call" : "calls"}
                        </span>
                      </span>
                      {g.answered ? (
                        <span className="shrink-0 text-xs text-emerald-700">Answer added</span>
                      ) : (
                        <Link
                          href={gapActionHref(g)}
                          className="shrink-0 text-xs font-medium text-indigo-700 underline underline-offset-2"
                        >
                          {g.suggestionId ? "Review drafted answer" : "Add an answer"}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              Based on {checked} {checked === 1 ? "call" : "calls"} with a transcript. Spam isn&apos;t
              counted.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
