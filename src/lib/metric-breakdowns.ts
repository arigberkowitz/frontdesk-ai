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
    revenue: [
      "Estimated revenue from realized bookings (cancellations and no-shows excluded).",
      `${m.bookings} booking${m.bookings === 1 ? "" : "s"} × ${money(m.avgServicePriceCents ?? 0)} avg service price`,
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
      `${handled} of ${m.totalCalls} handled on their own = ${formatPercent(m.containmentRate)}`,
    ],
    answerRate: [
      "Share of calls answered rather than missed.",
      `${answered} of ${m.totalCalls} answered = ${formatPercent(m.answerRate)}`,
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
