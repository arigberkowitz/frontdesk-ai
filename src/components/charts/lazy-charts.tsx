"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { CallsChart } from "./calls-chart";
import type { OutcomesChart } from "./outcomes-chart";

/**
 * The portal Overview's charts live inside the collapsed "Reports & trends"
 * panel, yet they used to ship recharts (the biggest thing in the Overview's
 * JavaScript) and render at width -1 on every load. These wrappers fetch the
 * chart code only when the chart actually scrolls into view — for a closed
 * <details>, that's when the owner opens it.
 */

function ChartSkeleton() {
  return <div aria-hidden className="h-64 w-full animate-pulse rounded-lg bg-muted/60" />;
}

const CallsChartImpl = dynamic(() => import("./calls-chart").then((m) => m.CallsChart), {
  ssr: false,
  loading: ChartSkeleton,
});
const OutcomesChartImpl = dynamic(() => import("./outcomes-chart").then((m) => m.OutcomesChart), {
  ssr: false,
  loading: ChartSkeleton,
});

function WhenVisible({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      // Very old browsers: just load it (async, so not a render cascade).
      const t = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return <div ref={ref}>{visible ? children : <ChartSkeleton />}</div>;
}

export function LazyCallsChart(props: ComponentProps<typeof CallsChart>) {
  return (
    <WhenVisible>
      <CallsChartImpl {...props} />
    </WhenVisible>
  );
}

export function LazyOutcomesChart(props: ComponentProps<typeof OutcomesChart>) {
  return (
    <WhenVisible>
      <OutcomesChartImpl {...props} />
    </WhenVisible>
  );
}
