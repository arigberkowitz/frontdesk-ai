/**
 * Queue a custom event for Vercel Analytics when that snippet is on the page.
 *
 * `@vercel/analytics` is landing in a separate PR. This talks to the same
 * `window.va` / `window.vaq` queue that package uses, so events are kept if
 * the snippet loads later, and this module is a no-op until then. It must
 * never throw — a missing or blocked analytics script cannot break the page.
 */
export type TrackProps = Record<string, string | number | boolean | null>;

type Va = (...args: unknown[]) => void;

export function trackEvent(name: string, properties?: TrackProps): void {
  if (typeof window === "undefined") return;
  try {
    const w = window as Window & { va?: Va; vaq?: unknown[] };
    const payload = properties ? { name, data: properties } : { name };
    if (typeof w.va === "function") {
      w.va("event", payload);
      return;
    }
    w.vaq = w.vaq ?? [];
    w.vaq.push(["event", payload]);
  } catch {
    // Analytics must never break the page.
  }
}
