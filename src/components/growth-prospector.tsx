"use client";

import { useActionState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { prospectAction, type GrowthState } from "@/lib/actions/growth";
import { cn } from "@/lib/utils";

function fitChip(score?: number): string {
  if (!score) return "bg-muted text-muted-foreground";
  if (score >= 4) return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (score === 3) return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

/** Agent #7 UI — paste prospect sites, get fit scores + outreach drafts. */
export function GrowthProspector() {
  const [state, action, pending] = useActionState<GrowthState, FormData>(prospectAction, {
    reports: null,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 sm:p-6">
          <form action={action} className="space-y-3">
            <label htmlFor="urls" className="fd-section-label">
              Prospect websites — one per line, up to five
            </label>
            <textarea
              id="urls"
              name="urls"
              rows={4}
              placeholder={"joesplumbingsf.com\nbrightsmiledental.com"}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
              disabled={pending}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                <Search className="size-4" />
                {pending ? "Reading their sites…" : "Score prospects"}
              </Button>
              {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {state.reports ? (
        <div className="fd-stagger space-y-3">
          {state.reports.map((r) => (
            <Card key={r.url}>
              <CardContent className="p-5">
                {r.ok ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                          fitChip(r.fitScore),
                        )}
                      >
                        fit {r.fitScore}/5
                      </span>
                      <span className="font-medium">{r.businessName || r.url}</span>
                      <span className="text-xs text-muted-foreground">{r.businessType}</span>
                    </div>
                    {r.signals?.length ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Signals: {r.signals.join(" · ")}
                      </p>
                    ) : null}
                    <div className="mt-3 rounded-lg bg-muted/60 p-3">
                      <p className="text-xs font-medium">{r.outreachSubject}</p>
                      <p className="mt-1.5 break-words whitespace-pre-wrap text-sm text-muted-foreground">
                        {r.outreachBody}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{r.url}</span> — {r.error}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
