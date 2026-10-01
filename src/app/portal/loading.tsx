/**
 * Portal route-level loading skeleton — shown while a page's data resolves.
 * Shaped like the pages it stands in for (a title, a feature panel, then rich
 * rows) with a soft shimmer; the shimmer stops under reduced motion.
 */
export default function PortalLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2.5">
        <div className="fd-skel h-[3px] w-8 rounded-full" />
        <div className="fd-skel h-8 w-48" />
        <div className="fd-skel h-4 w-72 max-w-full" />
      </div>
      <div className="fd-panel space-y-4 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="fd-skel size-14 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="fd-skel h-3 w-24" />
            <div className="fd-skel h-6 w-56 max-w-full" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="fd-skel h-16 rounded-xl" />
          ))}
        </div>
      </div>
      <ul className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="fd-row flex items-center gap-3 px-4 py-3">
            <div className="fd-skel size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="fd-skel h-3.5 w-40 max-w-full" />
              <div className="fd-skel h-3 w-64 max-w-full" />
            </div>
            <div className="fd-skel h-6 w-20 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
