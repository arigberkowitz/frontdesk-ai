/**
 * The weekly summary email — rendering only. Pure (no DB, no env) so the cron,
 * the portal preview route and the tests all render the exact same thing.
 */
import type { CallHealthSummary } from "./call-health";
import { formatCurrencyCents } from "./format";

/** The call/booking/lead/revenue numbers from `getClientPeriodSummary`. */
export interface WeeklyCoreStats {
  calls: number;
  /** Booked this week AND already happened (revenue is recognized on these). */
  bookings: number;
  afterHours: number;
  leads: number;
  estRevenueCents: number;
  upcomingRevenueCents: number;
}

/** The extra numbers the weekly summary adds (see data/weekly-summary.ts). */
export interface WeeklyActivity {
  /** Appointments created in the window that aren't cancelled / no-show. */
  bookingsMade: number;
  /** Appointments marked cancelled in the window. */
  cancellations: number;
  /** Customers who replied to an automated missed-call / no-show follow-up text. */
  missedRecovered: number;
  /** Inbound customer texts. */
  textsReceived: number;
}

export type WeeklySummaryStats = WeeklyCoreStats & WeeklyActivity;

/**
 * ISO-8601 week of a date, in UTC: "2026-W40". The dedupe key — one summary
 * per business per key. (The Thursday of the date's week decides the year.)
 */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // → Thursday of this week
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** A week with literally nothing in it isn't worth an email. */
export function hasWeeklyActivity(s: WeeklySummaryStats): boolean {
  return (
    s.calls + s.bookingsMade + s.bookings + s.leads + s.cancellations + s.textsReceived + s.missedRecovered > 0
  );
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&amp;",
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function statRow(label: string, value: string, sub?: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #eee;color:#555;font-size:14px">${label}${
      sub ? `<br><span style="color:#999;font-size:12px">${sub}</span>` : ""
    }</td>
    <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;font-size:20px;font-weight:600;color:#111">${value}</td>
  </tr>`;
}

/**
 * The part of the week nobody else sends.
 *
 * A weekly report that only contains good news trains the reader to skim it.
 * Worse, it means the first time a business hears that callers were asking for
 * a human and not getting one is when one of them says so. If the week was
 * clean, say that plainly — it's only worth believing because we'd have said
 * otherwise.
 */
function healthBlock(health?: CallHealthSummary | null): string {
  if (!health || health.total === 0) return "";
  const rows: string[] = [];
  if (health.strandedAskingForHuman > 0)
    rows.push(
      `${health.strandedAskingForHuman} caller${health.strandedAskingForHuman === 1 ? "" : "s"} asked for a person and didn't reach one`,
    );
  if (health.repeatedQuestion > 0)
    rows.push(
      `${health.repeatedQuestion} call${health.repeatedQuestion === 1 ? "" : "s"} where your AI had to ask the same thing three or more times`,
    );
  if (health.earlyHangup > 0)
    rows.push(`${health.earlyHangup} hung up within the first 15 seconds`);
  if (health.noContactCaptured > 0)
    rows.push(`${health.noContactCaptured} ended with no name or number to follow up on`);
  if (health.possibleEmergency > 0)
    rows.push(
      `<strong>${health.possibleEmergency} mentioned something that may have been urgent</strong>`,
    );

  if (!rows.length) {
    return `<p style="margin:16px 0 0;padding:10px 12px;background:#f0fdf4;border-radius:8px;font-size:14px;color:#166534">
    Every call this week went cleanly — nobody was left waiting, cut off, or asked the same thing twice.
  </p>`;
  }

  return `<div style="margin:18px 0 0;padding:12px;background:#fffbeb;border-radius:8px">
    <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#92400e">Worth a listen this week</p>
    <ul style="margin:0;padding-left:18px;color:#78350f;font-size:14px">
      ${rows.map((r) => `<li style="margin:2px 0">${r}</li>`).join("\n      ")}
    </ul>
    <p style="margin:8px 0 0;font-size:12px;color:#92400e">Each one is in your dashboard with the recording attached.</p>
  </div>`;
}

export interface WeeklySummaryEmailInput {
  businessName: string;
  stats: WeeklySummaryStats;
  health?: CallHealthSummary | null;
  /** App origin, e.g. "https://frontdeskai.company". */
  baseUrl: string;
}

export function weeklySummarySubject(s: WeeklySummaryStats): string {
  return `Your week: ${plural(s.calls, "call", "calls")} answered, ${plural(s.bookingsMade, "booking", "bookings")}${
    s.textsReceived > 0 ? `, ${plural(s.textsReceived, "text", "texts")}` : ""
  }`;
}

/** The retention machine: one glance says what the AI did this week. */
export function weeklySummaryEmail(input: WeeklySummaryEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { stats: s, health } = input;
  const base = input.baseUrl.replace(/\/$/, "");
  // Earned and upcoming are different claims and are never added together.
  const earned = formatCurrencyCents(s.estRevenueCents);
  const upcoming = formatCurrencyCents(s.upcomingRevenueCents);
  const bookedSub =
    s.bookings > 0 || s.upcomingRevenueCents > 0
      ? `${s.bookings} already happened (worth ${earned} at your listed prices)${
          s.upcomingRevenueCents > 0 ? ` · ${upcoming} still to come` : ""
        }`
      : "Appointments your AI put on the calendar";
  const settingsUrl = `${base}/portal/settings#weekly-summary`;

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto">
  <p style="color:#666;margin:0 0 4px;font-size:13px">Your week with FrontDesk AI</p>
  <h1 style="margin:0 0 6px;font-size:22px">${esc(input.businessName)}</h1>
  <p style="margin:0 0 18px;font-size:15px;color:#333">
    Your AI receptionist answered <strong>${plural(s.calls, "call", "calls")}</strong>
    and booked <strong>${plural(s.bookingsMade, "appointment", "appointments")}</strong> in the last 7 days.
  </p>
  <table style="width:100%;border-collapse:collapse">
    ${statRow("Calls answered", String(s.calls), "Every one picked up on the first ring")}
    ${statRow("Appointments booked", String(s.bookingsMade), bookedSub)}
    ${statRow("Cancellations", String(s.cancellations), s.cancellations > 0 ? "Those slots are open again — your AI can rebook them" : undefined)}
    ${statRow("After-hours saves", String(s.afterHours), "Calls that would have gone to voicemail")}
    ${statRow("Missed calls won back", String(s.missedRecovered), "Customers who replied to a follow-up text after a missed call or no-show")}
    ${statRow("New leads", String(s.leads), "Callers who left a callback request")}
    ${statRow("Texts from customers", String(s.textsReceived), s.textsReceived > 0 ? `<a href="${base}/portal/messages" style="color:#6366f1">Read and reply in Messages</a>` : undefined)}
  </table>
  ${healthBlock(health)}
  <p style="margin:20px 0">
    <a href="${base}/portal" style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Open your dashboard</a>
  </p>
  <p style="color:#999;font-size:12px;margin-top:18px">Sent every Monday by FrontDesk AI · numbers cover the last 7 days.<br>
  Don't want these? <a href="${settingsUrl}" style="color:#999">Turn off the weekly summary in Settings</a>.</p>
</div>`;

  const text = [
    `${input.businessName} — your last 7 days with FrontDesk AI`,
    "",
    `Calls answered: ${s.calls}`,
    `Appointments booked: ${s.bookingsMade} (${s.bookings} already happened, worth ${earned}${s.upcomingRevenueCents > 0 ? `; ${upcoming} still to come` : ""})`,
    `Cancellations: ${s.cancellations}`,
    `After-hours saves: ${s.afterHours}`,
    `Missed calls won back: ${s.missedRecovered}`,
    `New leads: ${s.leads}`,
    `Texts from customers: ${s.textsReceived}`,
    "",
    `Dashboard: ${base}/portal`,
    `Turn off the weekly summary: ${settingsUrl}`,
  ].join("\n");

  return { subject: weeklySummarySubject(s), html, text };
}
