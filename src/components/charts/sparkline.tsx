/** Tiny inline trend line for a metric card. Pure SVG — no client JS. */
export function Sparkline({
  data,
  color = "#6366f1",
  className,
}: {
  data: number[];
  color?: string;
  className?: string;
}) {
  const pts = data.filter((n) => Number.isFinite(n));
  if (pts.length < 2) return null;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const range = max - min || 1;
  const points = pts
    .map((v, i) => {
      const x = (i / (pts.length - 1)) * 100;
      const y = 24 - ((v - min) / range) * 20 - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
