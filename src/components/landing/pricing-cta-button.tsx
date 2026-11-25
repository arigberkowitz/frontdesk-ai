"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { trackFunnelEvent } from "@/lib/funnel-events";
import type { IntentInterval, IntentPlan } from "@/lib/signup-intent";

/**
 * Pricing-card CTA. A client island so the click can be recorded as a
 * conversion event without making the whole landing page a client component.
 * Properties are the plan key and billing interval only — never PII.
 */
export function PricingCtaButton({
  plan,
  interval,
  href,
  featured,
  className,
}: {
  plan: IntentPlan;
  interval: IntentInterval;
  href: string;
  featured: boolean;
  className?: string;
}) {
  return (
    <Button
      className={className}
      size="lg"
      variant={featured ? "default" : "outline"}
      nativeButton={false}
      render={
        <Link
          href={href}
          onClick={() => trackFunnelEvent("pricing_plan_cta", { plan, interval })}
        />
      }
    >
      Get started
    </Button>
  );
}
