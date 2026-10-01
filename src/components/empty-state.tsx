import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
}

/** Guiding empty state (§11: "Empty states should guide the operator to the next action"). */
export function EmptyState({ icon: Icon, title, description, children }: EmptyStateProps) {
  return (
    <div className="fd-glass flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/60 px-6 py-12 text-center">
      {Icon ? (
        // Decoration: the icon on a lit tile inside two quiet orbit rings.
        <div className="fd-empty-art mb-5" aria-hidden>
          <span className="fd-empty-spark right-2 top-3" />
          <span className="fd-empty-spark bottom-4 left-2" />
          <span className="fd-empty-icon">
            <Icon className="size-6" />
          </span>
        </div>
      ) : null}
      <h3 className="font-heading text-lg font-semibold">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
