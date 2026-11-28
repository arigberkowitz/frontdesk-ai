/**
 * The day-7 trial summary email — rendering only. Pure (no DB, no env) so the
 * cron, the tests and the screenshot harness all render the exact same thing.
 *
 * Halfway through a 14-day trial is when an owner decides whether this is
 * worth paying for. So it says what the AI actually did, from real rows, and
 * nothing else: no dollar estimates, no "you could have earned", no prices
 * (those live on the plans page and change without this file knowing).
 *
 * Two versions:
 *  - calls > 0: the counts, then the plan link.
 *  - calls = 0: zeros prove nothing and read like a failure, so it skips the
 *    table and says the one thing that usually fixes it — forward the line,
 *    or make the test call that gets the AI its number (number-gate.ts).
 */
import { formatPhone } from "./format";
import { forwardingCodes, type ForwardMode } from "./forwarding-codes";

export interface TrialSummaryStats {
  /** Real phone calls the AI answered since the trial started (not spam, missed or browser tests). */
  calls: number;
  /** Appointments the AI booked on a call, not cancelled / no-show. */
  booked: number;
  /** Messages it took (leads) since the trial started. */
  messages: number;
  /**
   * Of the answered calls, how many came in while the business was closed.
   * Null when the business has no opening hours saved — then nothing is ever
   * flagged after-hours and "0" would be a lie.
   */
  afterHours: number | null;
}

export interface TrialSummaryEmailInput {
  businessName: string;
  /** The receptionist's name, e.g. "Riley". */
  agentName: string;
  stats: TrialSummaryStats;
  /** Whole days left on the trial (from the cron's own calculation). */
  daysLeft: number;
  /** The AI's own phone number (E.164), or null if it hasn't been assigned yet. */
  aiNumber: string | null;
  answeringMode: ForwardMode;
  /** The owner ticked "forwarding done" on the checklist. */
  forwardingDone: boolean;
  /** App origin, e.g. "https://frontdeskai.company". */
  baseUrl: string;
  /** The "Questions?" footer line, HTML and plain (see lifecycle.questionsLine). */
  questionsHtml: string;
  questionsText: string;
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&amp;",
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function toText(html: string): string {
  return html
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function statRow(label: string, value: number, sub: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #eee;color:#555;font-size:14px">${label}<br><span style="color:#999;font-size:12px">${sub}</span></td>
    <td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right;font-size:20px;font-weight:600;color:#111">${value}</td>
  </tr>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">${label}</a>`;
}

export function hasTrialCalls(s: TrialSummaryStats): boolean {
  return s.calls > 0;
}

export function trialSummarySubject(input: Pick<TrialSummaryEmailInput, "businessName" | "stats">): string {
  const s = input.stats;
  if (!hasTrialCalls(s)) return `${input.businessName}: one step left before your AI takes calls`;
  return `${input.businessName}: your first week — ${plural(s.calls, "call")} answered${
    s.booked > 0 ? `, ${s.booked} booked` : ""
  }`;
}

/** The day-7 email. Real counts when there are calls; a setup nudge when there aren't. */
export function trialSummaryEmail(input: TrialSummaryEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const s = input.stats;
  const base = input.baseUrl.replace(/\/$/, "");
  const name = esc(input.businessName);
  const agent = esc(input.agentName.trim() || "Riley");
  const plansUrl = `${base}/portal/guidelines?plans=open#plans`;
  const daysLeft = Math.max(0, input.daysLeft);
  const days = plural(daysLeft, "day");

  const blocks: string[] = []; // HTML paragraphs/sections, in order
  const textLines: string[] = [];

  const p = (html: string, style = "margin:0 0 14px;font-size:15px;color:#333") => {
    blocks.push(`<p style="${style}">${html}</p>`);
    textLines.push(toText(html), "");
  };

  if (hasTrialCalls(s)) {
    p(
      `Since your free trial started, ${agent} has answered <strong>${plural(s.calls, "call")}</strong> for ${name}.`,
    );
    const rows = [
      statRow("Calls answered", s.calls, "Real calls from customers — spam and test calls left out"),
      statRow("Appointments booked", s.booked, "Booked on a call and still on the calendar"),
      statRow("Messages taken", s.messages, "Callers who left a message for you to call back"),
    ];
    textLines.push(
      `Calls answered: ${s.calls}`,
      `Appointments booked: ${s.booked}`,
      `Messages taken: ${s.messages}`,
    );
    if (s.afterHours != null) {
      rows.push(statRow("After-hours calls handled", s.afterHours, "Calls that came in while you were closed"));
      textLines.push(`After-hours calls handled: ${s.afterHours}`);
    }
    blocks.push(`<table style="width:100%;border-collapse:collapse;margin:0 0 16px">
    ${rows.join("\n    ")}
  </table>`);
    textLines.push("");
    if (s.afterHours == null) {
      p(
        `Add your opening hours under <a href="${base}/portal/hours" style="color:#4f46e5">Hours</a> and we'll also count the calls it handles while you're closed.`,
        "margin:0 0 14px;font-size:13px;color:#666",
      );
    }
    p(`Every call has its recording and summary in your <a href="${base}/portal/calls" style="color:#4f46e5">call log</a>.`);
  } else if (input.aiNumber) {
    const num = formatPhone(input.aiNumber);
    const fwd = forwardingCodes(input.answeringMode, input.aiNumber);
    if (input.forwardingDone) {
      p(
        `${agent} is ready, but no customer calls have reached it yet. You marked forwarding as done, so it's worth a quick check: call your business number from another phone. If ${agent} doesn't pick up, the forward didn't take.`,
      );
      p(`To set it again: ${fwd.turnOnHtml}`);
    } else {
      p(
        `${agent} is ready, but no customer calls have reached it yet. That almost always means your business line isn't forwarded to it.`,
      );
      p(`<strong>1.</strong> Call <strong>${num}</strong> from your cell and ask it something a customer would.`);
      p(`<strong>2.</strong> Forward your business line to it. ${fwd.turnOnHtml}`);
      p(`Then tap <strong>Test my forwarding</strong> under <a href="${base}/portal/settings/phone#forwarding" style="color:#4f46e5">Settings → Phone &amp; AI</a> to check it works. Your customers keep calling the number they already know. ${fwd.turnOff}`, "margin:0 0 14px;font-size:13px;color:#666");
    }
  } else {
    p(
      `${agent} is built and ready for ${name}, but it doesn't have its own phone number yet, so no customer calls have reached it.`,
    );
    p(
      `It gets one, free for the rest of your trial, as soon as you make one test call in your browser. Your <a href="${base}/portal" style="color:#4f46e5">Overview</a> shows what's left to set up.`,
    );
    p(`Haven't heard it yet? <a href="${base}/portal/guidelines" style="color:#4f46e5">Try a test call in your browser</a>.`);
  }

  // The plan line. Prices are deliberately not here — they're on the plans page.
  p(
    `Your free trial has <strong>${days}</strong> left. To keep ${agent} booking and answering questions after that, pick a plan. Every plan is one flat monthly price. Everything you've set up stays.`,
  );
  blocks.push(`<p style="margin:6px 0 20px">${button(plansUrl, "Pick a plan")}</p>`);
  textLines.push(`Pick a plan: ${plansUrl}`, "");

  const footerHtml = `${input.questionsHtml} · FrontDesk AI<br>This is a one-time email about your free trial.`;
  textLines.push(toText(input.questionsText), "This is a one-time email about your free trial.");

  const heading = hasTrialCalls(s) ? "Your first week with FrontDesk AI" : "A week into your free trial";
  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;line-height:1.5">
  <p style="color:#666;margin:0 0 4px;font-size:13px">${heading}</p>
  <h1 style="margin:0 0 16px;font-size:22px">${name}</h1>
  ${blocks.join("\n  ")}
  <p style="color:#999;font-size:12px;margin-top:18px">${footerHtml}</p>
</div>`;

  const text = [`${input.businessName} — ${heading}`, "", ...textLines].join("\n");
  return { subject: trialSummarySubject(input), html, text };
}
