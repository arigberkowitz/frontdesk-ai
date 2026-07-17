"use client";

import { useTransition } from "react";
import { Check, GraduationCap, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PanelHeader } from "@/components/panel-header";
import { approveSuggestionAction, dismissSuggestionAction } from "@/lib/actions/suggestions";
import type { AgentSuggestion } from "@/db/schema";

/**
 * "Your AI learned N things" — the human-in-the-loop gate for the nightly
 * improvement agent. Approve teaches the receptionist (writes knowledge /
 * guidance and republishes the live prompt); dismiss archives the idea.
 */
export function AiLearnings({
  clientId,
  suggestions,
  canEdit = true,
}: {
  clientId: string;
  suggestions: AgentSuggestion[];
  /** Staff without the edit code see the learnings but can't approve them. */
  canEdit?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  if (suggestions.length === 0) return null;

  const act = (action: (fd: FormData) => Promise<void>, suggestionId: string) => {
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("suggestionId", suggestionId);
    startTransition(() => action(fd));
  };

  return (
    <Card className="border-indigo-500/30">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={GraduationCap}
          title={`Your AI learned ${suggestions.length} thing${suggestions.length === 1 ? "" : "s"}`}
          description="From real calls it handled. Approve to teach it — nothing changes until you do."
        />

        <ul className="mt-4">
          {suggestions.map((s) => {
            const evidence = (s.evidence ?? {}) as { excerpt?: string };
            return (
              <li key={s.id} className="border-t py-4 first:border-t-0 first:pt-3 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="fd-section-label">
                      {s.type === "knowledge" ? "New answer" : "Behavior tweak"}
                    </span>
                    {s.type === "knowledge" ? (
                      <>
                        <p className="mt-1 text-sm font-medium">{s.question}</p>
                        {s.answer ? (
                          <p className="mt-0.5 text-sm text-muted-foreground">{s.answer}</p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-1 text-sm font-medium">{s.guidance}</p>
                    )}
                    <p className="mt-1.5 text-xs text-muted-foreground">{s.rationale}</p>
                    {evidence.excerpt ? (
                      <p className="mt-1.5 border-l-2 border-indigo-500/30 pl-2 text-xs italic text-muted-foreground">
                        “{evidence.excerpt}”
                      </p>
                    ) : null}
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => act(approveSuggestionAction, s.id)}
                      >
                        <Check className="size-3.5" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => act(dismissSuggestionAction, s.id)}
                      >
                        <X className="size-3.5" />
                        Dismiss
                      </Button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      awaiting your admin
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
