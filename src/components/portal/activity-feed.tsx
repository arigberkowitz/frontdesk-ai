import { Activity, CalendarCheck, MessageSquare, Moon, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ActivityItem } from "@/lib/data/activity";

const META: Record<ActivityItem["kind"], { Icon: LucideIcon; chip: string }> = {
  booking: { Icon: CalendarCheck, chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  message: { Icon: MessageSquare, chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  afterhours: { Icon: Moon, chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
};

/** Relative time — durations are timezone-independent, so this is always accurate. */
function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Recent activity feed. Renders nothing when there's no activity yet. */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Activity className="size-4" />
        Recent activity
      </h2>
      <Card>
        <CardContent className="px-5 py-1">
          <ul>
            {items.map((it, i) => {
              const { Icon, chip } = META[it.kind];
              return (
                <li key={`${it.at}-${i}`} className="flex items-start gap-3 border-t py-3 first:border-t-0">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${chip}`}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{it.title}</span>
                      {it.detail ? <span className="text-muted-foreground"> — {it.detail}</span> : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{ago(it.at)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
