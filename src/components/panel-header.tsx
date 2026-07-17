import type { LucideIcon } from "lucide-react";

/**
 * The one way an agent panel introduces itself: indigo icon chip, serif title,
 * quiet description, optional right-side action. Every "the AI did something"
 * card uses this so the whole app reads as one hand.
 */
export function PanelHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <Icon className="size-4" />
        </span>
        <div>
          <p className="font-heading text-lg font-semibold tracking-tight">{title}</p>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}
