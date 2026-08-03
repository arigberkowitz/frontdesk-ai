import { formatCurrencyCents, formatPercent } from "@/lib/format";
import type { ClientMetrics } from "@/lib/data/metrics";

/**
 * Plain-English "what it means + the math" breakdowns for a single client's
 * overview cards. Shared by the operator's client view and the client portal so
 * both explain the same numbers the same way. Pure (no server/client specifics).
 */
export function clientMetricBreakdowns(m: ClientMetrics): Record<string, string[]> {
  const money = formatCurrencyCents;
  const handled = Math.max(0, m.totalCalls - m.escalated);
  const answered = Math.max(0, m.totalCalls - m.missed);
  return {
    // Don't print a multiplication that doesn't produce the number above it.
    // Revenue is a SUM of each completed appointment's own service price, so a
    // $1,000 consultation contributes $1,000 — not the portfolio average.
    revenue: [
      "Appointments that have already happened, valued at the price of the service actually booked. Cancellations and no-shows excluded.",
      m.bookings > 0
        ? `${m.completedBookings} of ${m.bookings} booking${m.bookings === 1 ? "" : "s"} completed so far`
        : "No bookings yet.",
      `= ${money(m.estRevenueCents)}`,
    ],
    calls: [
      "Every inbound call your AI answered.",
      `${m.totalCalls} total · ${m.missed} missed · ${m.afterHoursCalls} after-hours`,
    ],
    bookings: [
      "Appointments booked, not counting cancellations or no-shows.",
      `${m.bookings} realized booking${m.bookings === 1 ? "" : "s"}`,
    ],
    afterHours: [
      "Calls answered outside business hours — ones you'd likely have missed.",
      `${m.afterHoursCalls} after-hours call${m.afterHoursCalls === 1 ? "" : "s"}`,
    ],
    containment: [
      "Share of calls handled without transferring to a person.",
      m.totalCalls > 0
        ? `${handled} of ${m.totalCalls} handled on their own = ${formatPercent(m.containmentRate)}`
        : "No calls yet — there's nothing to compute a rate from.",
    ],
    answerRate: [
      "Share of calls answered rather than missed.",
      m.totalCalls > 0
        ? `${answered} of ${m.totalCalls} answered = ${formatPercent(m.answerRate)}`
        : "No calls yet — there's nothing to compute a rate from.",
    ],
    leads: [
      "Callers who left a message when booking wasn't the right fit.",
      `${m.leads} captured${m.newLeads > 0 ? ` · ${m.newLeads} new, awaiting follow-up` : ""}`,
    ],
    sentiment: [
      "Net caller mood across rated calls (positive minus negative).",
      m.sentimentScore == null
        ? "No rated calls yet."
        : `Score ${m.sentimentScore.toFixed(2)} on a −1 to +1 scale`,
    ],
  };
}
