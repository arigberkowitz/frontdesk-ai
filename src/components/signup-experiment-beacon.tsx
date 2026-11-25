"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics-track";
import type { HeadlineVariant, HighlightVariant } from "@/lib/pricing-experiment";

/** Fires once when a visitor lands on /sign-up, with the variants they were shown. */
export function SignupExperimentBeacon({
  headline,
  highlight,
  plan,
  interval,
}: {
  headline: HeadlineVariant;
  highlight: HighlightVariant;
  plan: string;
  interval: string;
}) {
  useEffect(() => {
    trackEvent("signup_view", { headline, highlight, plan, interval });
  }, [headline, highlight, plan, interval]);
  return null;
}
