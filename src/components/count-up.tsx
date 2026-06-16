"use client";

import { useEffect, useState } from "react";

/** Pull the numeric core out of a formatted value like "$1,227" or "73%". */
function parse(value: string) {
  const m = value.match(/-?[\d,]*\.?\d+/);
  if (!m) return null;
  const numStr = m[0];
  const start = m.index ?? 0;
  return {
    prefix: value.slice(0, start),
    suffix: value.slice(start + numStr.length),
    target: parseFloat(numStr.replace(/,/g, "")),
    decimals: numStr.includes(".") ? (numStr.split(".")[1]?.length ?? 0) : 0,
    grouped: numStr.includes(","),
  };
}

/** Animates a formatted number up from 0 on mount; preserves prefix/suffix
 *  ("$", "%") and grouping. Non-numeric values (e.g. "Positive") render as-is.
 *  Respects prefers-reduced-motion. */
export function CountUp({ value, className }: { value: string; className?: string }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const p = parse(value);
    if (!p || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)) {
      setDisplay(value);
      return;
    }
    const fmt = (n: number) => {
      const grouped = p.grouped
        ? n.toLocaleString("en-US", { minimumFractionDigits: p.decimals, maximumFractionDigits: p.decimals })
        : p.decimals
          ? n.toFixed(p.decimals)
          : String(Math.round(n));
      return `${p.prefix}${grouped}${p.suffix}`;
    };
    const dur = 850;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(fmt(p.target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return (
    <span className={className} suppressHydrationWarning>
      {display}
    </span>
  );
}
