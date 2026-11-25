"use client";

import { trackFunnelEvent } from "@/lib/funnel-events";

/**
 * The live demo-line number on the landing page. Clicking it (to place the
 * call) is the closest thing we have to "demo call requested."
 */
export function DemoPhoneLink({ phone, label }: { phone: string; label: string }) {
  const href = `tel:${phone.replace(/[^\d+]/g, "")}`;
  return (
    <a
      href={href}
      onClick={() => trackFunnelEvent("demo_call_requested")}
      className="mt-2 inline-block font-heading text-2xl font-semibold tracking-tight underline-offset-4 hover:underline"
    >
      {label}
    </a>
  );
}
