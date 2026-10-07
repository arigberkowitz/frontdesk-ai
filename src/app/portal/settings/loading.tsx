/**
 * Switching Settings tabs keeps the header and tabs (the layout) and shows
 * this in place of the section, instead of freezing on the old tab until the
 * new one's data arrives — which on a phone reads as "my tap didn't work".
 */
export default function SettingsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 2 }).map((_, card) => (
        <div key={card} className="fd-panel space-y-5 p-5 sm:p-6">
          <div className="space-y-2">
            <div className="fd-skel h-5 w-40" />
            <div className="fd-skel h-3.5 w-72 max-w-full" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="fd-skel h-3 w-28" />
              <div className="fd-skel h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
