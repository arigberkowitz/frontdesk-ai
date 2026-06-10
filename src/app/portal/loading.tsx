/** Portal route-level loading skeleton — shown while a page's data resolves. */
export default function PortalLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded-md bg-muted/70" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}
