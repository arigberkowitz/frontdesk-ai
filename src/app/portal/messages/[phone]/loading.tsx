/** A conversation, shaped like one: alternating bubbles, then the reply box. */
export default function ThreadLoading() {
  const bubbles = [
    { mine: false, w: "w-56" },
    { mine: true, w: "w-64" },
    { mine: false, w: "w-40" },
    { mine: true, w: "w-52" },
  ];
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3">
        <div className="fd-skel size-10 shrink-0 rounded-full" />
        <div className="space-y-2">
          <div className="fd-skel h-4 w-36" />
          <div className="fd-skel h-3 w-24" />
        </div>
      </div>
      <div className="fd-panel space-y-3 p-4 sm:p-5">
        {bubbles.map((b, i) => (
          <div key={i} className={b.mine ? "flex justify-end" : "flex"}>
            <div className={`fd-skel h-12 max-w-[80%] rounded-2xl ${b.w}`} />
          </div>
        ))}
        <div className="fd-skel mt-4 h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}
