interface PageHeaderProps {
  title: React.ReactNode;
  description?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1.5">
        <h1 data-slot="page-title" className="font-heading text-[1.75rem] font-semibold leading-tight tracking-[-0.025em] text-balance sm:text-[2.25rem]">{title}</h1>
        {description ? <p className="max-w-2xl text-[0.9375rem] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}
