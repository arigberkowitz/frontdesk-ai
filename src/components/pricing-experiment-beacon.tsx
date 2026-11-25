"use client";

import { useEffect } from "react";
import { FlagValues } from "flags/react";
import { trackEvent } from "@/lib/analytics-track";
import {
  PRICING_HEADLINE_KEY,
  PRICING_HIGHLIGHT_KEY,
  type HeadlineVariant,
  type HighlightVariant,
} from "@/lib/pricing-experiment";

/**
 * Records the assigned pricing variants on impression and on a click through
 * to sign-up, and exposes the values to Flags Explorer / Web Analytics via
 * a `FlagValues` tag (Vercel Analytics reads flags from the DOM).
 */
export function PricingExperimentBeacon({
  headline,
  highlight,
}: {
  headline: HeadlineVariant;
  highlight: HighlightVariant;
}) {
  useEffect(() => {
    trackEvent("pricing_impression", { headline, highlight });

    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || !href.startsWith("/sign-up")) return;
      const url = new URL(href, window.location.origin);
      trackEvent("pricing_cta", {
        headline,
        highlight,
        plan: url.searchParams.get("plan") ?? "",
        interval: url.searchParams.get("interval") ?? "month",
      });
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [headline, highlight]);

  return (
    <FlagValues
      values={{
        [PRICING_HEADLINE_KEY]: headline,
        [PRICING_HIGHLIGHT_KEY]: highlight,
      }}
    />
  );
}
