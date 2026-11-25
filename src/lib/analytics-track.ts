/**
 * Custom events for Vercel Web Analytics.
 *
 * Uses the official `@vercel/analytics` `track()` helper already mounted in
 * the root layout. It queues events if the snippet has not loaded yet and is
 * a no-op when the script is missing or blocked. This must never throw — a
 * missing analytics script cannot break the page.
 *
 * Experiment events (`pricing_impression`, `pricing_cta`, `signup_view`) are
 * separate from the signup-funnel events in `funnel-events.ts`. Event names
 * are kept as-is so existing test and dashboard queries still match.
 */
import { track } from "@vercel/analytics";

export type TrackProps = Record<string, string | number | boolean | null>;

export function trackEvent(name: string, properties?: TrackProps): void {
  if (typeof window === "undefined") return;
  try {
    track(name, properties);
  } catch {
    // Analytics must never break the page.
  }
}
