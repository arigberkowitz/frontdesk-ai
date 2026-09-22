import { useId } from "react";

/**
 * Tiny inline trend line for a metric card. Pure SVG — no client JS.
 *
 * A line, a soft fill under it, and a dot on today. With `labels`, every
 * point carries a native tooltip ("Sep 20 · 3 calls"), so hovering the line
 * answers "what was that spike?" without a chart library.
 */
export function Sparkline({
  data,
  color = "#6366f1",
  className,
  labels,
}: {
  data: number[];
  color?: string;
  className?: string;
  /** One per point; shown as a tooltip on hover. */
  labels?: string[];
}) {
  const gradientId = useId();
  const pts = data.filter((n) => Number.isFinite(n));
  if (pts.length < 2) return null;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const range = max - min || 1;
  const flat = max === min;
  const coords = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * 100;
    // A run of identical values sits low, not mid-chart — a flat line at the
    // top reads as "maxed out", and at zero it should look like zero.
    const y = flat ? 20 : 24 - ((v - min) / range) * 20 - 2;
    return [x, y] as const;
  });
  const points = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,24 ${points} 100,24`;
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={className}
      aria-hidden={labels ? undefined : true}
      role={labels ? "img" : undefined}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The dot on today. The SVG stretches to the card (preserveAspectRatio
          none), which turns a <circle> into a wide ellipse; a zero-length line
          with round caps and a non-scaling stroke stays a round 6px dot. */}
      <line
        x1={lastX}
        y1={lastY}
        x2={lastX + 0.001}
        y2={lastY}
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {labels
        ? coords.map(([x], i) => (
            // Wide invisible hit targets so the tooltip lands wherever the
            // pointer is along the line, not only on the pixel of the point.
            <rect
              key={i}
              x={i === 0 ? 0 : x - 50 / (pts.length - 1)}
              y={0}
              width={i === 0 || i === pts.length - 1 ? 50 / (pts.length - 1) : 100 / (pts.length - 1)}
              height={24}
              fill="transparent"
            >
              <title>{labels[i]}</title>
            </rect>
          ))
        : null}
    </svg>
  );
}
