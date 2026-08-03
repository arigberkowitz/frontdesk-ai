import { AlertTriangle, CheckCircle2, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { HealthItem } from "@/lib/data/integration-health";
import { cn } from "@/lib/utils";

/**
 * Operator-only status board for this deployment's integrations.
 *
 * Sorted broken-first, because the only time anyone opens this is when
 * something is quietly not working and they need to find out what.
 */
export function IntegrationHealth({
  items,
  appUrl,
  failing,
}: {
  items: HealthItem[];
  appUrl: string;
  failing: number;
}) {
  const sorted = [...items].sort((a, b) => Number(a.ok) - Number(b.ok));

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-heading text-lg font-semibold">Integrations</h2>
            <p className="text-sm text-muted-foreground">
              {failing === 0
                ? "Everything this deployment needs is configured."
                : `${failing} not configured — each one fails silently, so nothing else will tell you.`}
            </p>
          </div>
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium",
              failing === 0
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
          >
            {failing === 0 ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <AlertTriangle className="size-4" />
            )}
            {failing === 0 ? "All set" : `${failing} missing`}
          </span>
        </div>

        <ul className="divide-y rounded-lg border">
          {sorted.map((i) => (
            <li key={i.key} className="flex items-start justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {i.ok ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                  )}
                  {i.label}
                </p>
                {!i.ok ? (
                  <p className="mt-0.5 pl-6 text-sm text-muted-foreground">{i.breaks}</p>
                ) : null}
              </div>
              {!i.ok ? (
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {i.missing.map((name) => (
                    <code
                      key={name}
                      className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400"
                    >
                      {name}
                    </code>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {/* Public hostname, not a secret — and the value most likely to be stale
            after a domain move. Webhook signatures are verified against it, so
            a mismatch here breaks inbound messages with a generic 401. */}
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe className="size-4 shrink-0" />
          Webhooks are signed and verified against <code className="text-foreground">{appUrl}</code>
          . Anything pointed at a different hostname will fail its signature check.
        </p>
      </CardContent>
    </Card>
  );
}
