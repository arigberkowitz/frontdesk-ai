import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { AgentVersion, User } from "@/db/schema";

type VersionWithPublisher = AgentVersion & { publisher: User | null };

/**
 * Prompt changelog — every published version of this client's agent, newest
 * first. Proof the receptionist improves over time (and a rollback reference:
 * each snapshot is the full prompt as it went live).
 */
export function PromptChangelog({ versions }: { versions: VersionWithPublisher[] }) {
  if (versions.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <History className="size-4" />
          </span>
          <div>
            <p className="font-heading text-lg font-semibold tracking-tight">Prompt versions</p>
            <p className="text-sm text-muted-foreground">
              Every publish, snapshotted — how this receptionist has evolved.
            </p>
          </div>
        </div>
        <ul className="mt-3">
          {versions.slice(0, 10).map((v) => (
            <li key={v.id} className="border-t py-3 first:border-t-0">
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 font-heading text-xs font-semibold text-indigo-600 tabular-nums dark:text-indigo-400">
                    v{v.version}
                  </span>
                  <span className="text-sm font-medium">
                    {v.notes?.trim() || "Published"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(v.publishedAt)}
                    {v.publisher?.email ? ` · ${v.publisher.email}` : ""}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground group-open:hidden">
                    view prompt
                  </span>
                </summary>
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                  {v.promptSnapshot}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
