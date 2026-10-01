/**
 * Call recaps: one crisp alert after a call that a human now has to act on.
 *
 * Two kinds of call leave the business holding something:
 *
 *  - **A message was taken** (the AI's take_message tool created a lead —
 *    this is also what happens when a transfer rings out and the AI falls back
 *    to taking a message).
 *  - **The call was transferred** to a person — either it connected (the
 *    teammate has context, but the rest of the team doesn't) or it failed
 *    (rang out to a voicemail box, or dropped the moment it connected).
 *
 * The recap says who called (and whether we already know them), what they
 * want, how urgent it is, the suggested reply, and links to the call.
 *
 * It **replaces** the old mid-call "New message" alert on voice calls and the
 * "asked for a person and didn't get one" / "possible emergency" call-problem
 * alert on these calls, so an owner gets exactly one alert per call. Web-chat
 * messages keep the instant alert (there is no call to recap).
 *
 * Pure and client-safe — no DB, no model — so every rule here is unit-tested.
 * Everything that came from the caller (names, reasons, quoted messages, the
 * AI's suggested reply, Retell's summary) is DATA: HTML-escaped, length-capped,
 * and labelled as caller-provided. No model reads this content to take an
 * action, so there's no new prompt-injection surface.
 */

import { transferDroppedImmediately, transferLines, transferReachedVoicemail } from "./call-health";
import { formatDateTime, formatPhone } from "./format";

export const CALL_RECAP_KIND = "call_recap";

export type RecapKind = "message" | "transfer" | "transfer_failed";

/** Same words the existing lead alert treats as urgent, so behaviour carries over. */
export const LEAD_URGENT = /asap|urgent|emergenc|right away|immediately|today|leak|flood|burst/i;

export interface TransferStatus {
  attempted: boolean;
  /** Attempted but never reached a person (voicemail, dropped, or cancelled). */
  failed: boolean;
}

/**
 * Did the AI transfer this call, and did it reach a person?
 *
 * Two independent signals, because each misses cases: Retell's
 * `disconnection_reason` (`call_transfer` when the AI handed off and left,
 * `transfer_cancelled` when the transfer didn't go through), and
 * `Transfer Target:` lines in the transcript (warm/conferenced transfers, where
 * the callee's words are recorded — that's how we spot a voicemail greeting).
 */
export function transferStatus(input: {
  transcript: string | null | undefined;
  disconnectionReason: string | null | undefined;
  durationSec: number | null | undefined;
}): TransferStatus {
  const transcript = input.transcript ?? "";
  const reason = (input.disconnectionReason ?? "").toLowerCase();
  const attempted =
    transferLines(transcript).length > 0 ||
    reason === "call_transfer" ||
    reason === "transfer_cancelled";
  if (!attempted) return { attempted: false, failed: false };
  const failed =
    reason === "transfer_cancelled" ||
    transferReachedVoicemail(transcript) ||
    transferDroppedImmediately(transcript, input.durationSec);
  return { attempted, failed };
}

/**
 * Which recap (if any) this call gets. Inbound only — an outbound AI callback
 * is our call, not a customer reaching out. Spam never alerts.
 */
export function recapKindFor(input: {
  direction: string | null | undefined;
  outcome: string | null | undefined;
  hasLead: boolean;
  transfer: TransferStatus;
}): RecapKind | null {
  if (input.direction !== "inbound") return null;
  if (input.outcome === "spam") return null;
  if (input.hasLead) return "message";
  if (input.transfer.attempted) return input.transfer.failed ? "transfer_failed" : "transfer";
  return null;
}

/**
 * The message tool's instant "New message" alert is deferred to the recap only
 * when a recap is guaranteed to know about the lead: a voice call whose row
 * already exists (so the lead carries its call id) and that the customer made.
 * Web chat, or a lead with no call row yet, keeps the instant alert.
 */
export function leadAlertDeferredToRecap(input: {
  channel: string;
  call: { direction: string } | null;
}): boolean {
  return input.channel === "voice" && input.call?.direction === "inbound";
}

/**
 * May this recap text the alert phone(s)? Only where the existing settings
 * already text that kind of alert: SMS alerts are on, AND it's a message
 * (lead alerts were always texted), a failed transfer or an emergency (the
 * call-problem alert was always texted). A transfer that connected is
 * informational — email only, never the owner's phone.
 */
export function recapSmsAllowed(kind: RecapKind, urgent: boolean, smsAlertsEnabled: boolean): boolean {
  if (!smsAlertsEnabled) return false;
  return kind === "message" || kind === "transfer_failed" || urgent;
}

export interface RecapFacts {
  kind: RecapKind;
  business: string;
  timezone: string;
  call: {
    id: string;
    fromNumber: string | null;
    startAt: Date | null;
    /** Retell's post-call summary (model-written from the caller's words). */
    summary: string | null;
  };
  lead: {
    name: string | null;
    phone: string | null;
    reason: string | null;
    message: string | null;
    service: string | null;
    urgency: string | null;
  } | null;
  /** Agent #2 (extract.ts) output, when it ran. */
  insights: {
    name: string;
    service: string;
    requestedDate: string;
    followUpDraft: string | null;
  } | null;
  caller: {
    /** Name on file for this number from an earlier booking/message. */
    knownName: string | null;
    priorCalls: number;
    pastAppointments: number;
    nextAppointment: Date | null;
  };
  /** call-health problem flags for this call (see `analyzeCall`). */
  health: { problems: string[] };
  link: string;
}

function clean(s: string | null | undefined, max = 300): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function esc(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&amp;",
  );
}

export function recapUrgent(f: Pick<RecapFacts, "lead" | "health">): boolean {
  if (f.health.problems.includes("possible_emergency")) return true;
  return f.lead ? LEAD_URGENT.test(`${f.lead.urgency ?? ""} ${f.lead.reason ?? ""}`) : false;
}

/** The few call-health findings worth a line in the recap — not the full QA list. */
export function recapNotes(kind: RecapKind, problems: string[]): string[] {
  const notes: string[] = [];
  if (problems.includes("transferred_to_voicemail"))
    notes.push("The transfer rang through to a voicemail box, not a person.");
  if (problems.includes("transfer_dropped"))
    notes.push("The transfer may not have connected — the call ended seconds after it started.");
  if (kind === "transfer_failed" && !notes.length)
    notes.push("The transfer didn't go through.");
  if (kind !== "transfer" && problems.includes("stranded_asking_for_human"))
    notes.push("They asked for a person.");
  if (problems.includes("possible_emergency"))
    notes.push("The caller used words that may signal an emergency — worth listening to first.");
  return notes;
}

export interface Recap {
  urgent: boolean;
  subject: string;
  html: string;
  text: string;
  sms: string;
}

/** Build the recap email + SMS. Pure. */
export function buildRecap(f: RecapFacts): Recap {
  const urgent = recapUrgent(f);
  const callerId = f.call.fromNumber;
  const callback = f.lead?.phone || callerId;
  const name = clean(f.lead?.name || f.insights?.name || f.caller.knownName, 60) || null;
  const phoneLabel = callback ? formatPhone(callback) : "an unknown number";
  const who = name ?? phoneLabel;
  const when = f.call.startAt ? formatDateTime(f.call.startAt, f.timezone) : null;

  const customer =
    f.caller.pastAppointments > 0
      ? `Existing customer · ${f.caller.pastAppointments} past appointment${f.caller.pastAppointments === 1 ? "" : "s"}`
      : f.caller.nextAppointment
        ? "Existing customer"
        : f.caller.priorCalls > 0
          ? `Called ${f.caller.priorCalls} time${f.caller.priorCalls === 1 ? "" : "s"} before · no bookings yet`
          : "New caller";
  const upcoming = f.caller.nextAppointment
    ? `Next appointment: ${formatDateTime(f.caller.nextAppointment, f.timezone)}`
    : null;

  const wantsParts = [
    clean(f.lead?.reason, 160),
    clean(f.lead?.service || f.insights?.service, 80),
  ].filter((p, i, arr) => p && arr.indexOf(p) === i);
  const wants = wantsParts.join(" — ") || clean(f.call.summary, 240) || "Not stated — listen to the call.";
  const requested = clean(f.insights?.requestedDate, 80);
  const quoted = clean(f.lead?.message, 400);

  const urgencyLabel = urgent
    ? "🚨 Urgent — call back now"
    : clean(f.lead?.urgency, 60)
      ? `Caller said: “${clean(f.lead?.urgency, 60)}”`
      : "Not urgent";

  const draft = clean(f.insights?.followUpDraft, 320);
  const bestReply =
    f.kind === "transfer"
      ? draft
        ? `If your teammate didn't wrap it up: text back “${draft}”`
        : "Your teammate spoke with them — nothing else needed unless something was promised."
      : draft
        ? `Text back: “${draft}”`
        : callback
          ? `Call back at ${formatPhone(callback)}.`
          : "We didn't get a callback number — listen to the call for details.";

  const headline =
    f.kind === "message"
      ? f.health.problems.includes("transferred_to_voicemail") ||
        f.health.problems.includes("transfer_dropped")
        ? `${who} left a message after a transfer didn't connect`
        : `${who} left a message`
      : f.kind === "transfer"
        ? `${who} was transferred to your team`
        : `${who} tried to reach a person — the transfer didn't connect`;
  const emoji = urgent ? "🚨" : f.kind === "message" ? "📨" : f.kind === "transfer" ? "📞" : "⚠️";
  const subject = `${urgent ? "🚨 Urgent — " : ""}${headline} · ${f.business}`;

  const differentCallback = Boolean(f.lead?.phone && callerId && f.lead.phone.replace(/\D/g, "").slice(-10) !== callerId.replace(/\D/g, "").slice(-10));
  const whoLine = [
    name ? `<strong>${esc(name)}</strong>` : null,
    callback ? esc(formatPhone(callback)) : null,
    differentCallback ? `(called from ${esc(formatPhone(callerId))})` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const rows: [string, string][] = [
    ["Who", `${whoLine || "Unknown caller"}<br><span style="color:#555">${esc(customer)}${upcoming ? ` · ${esc(upcoming)}` : ""}</span>`],
    ["Wants", `${esc(wants)}${requested ? `<br><span style="color:#555">Asked for: ${esc(requested)}</span>` : ""}`],
    ["Urgency", esc(urgencyLabel)],
    ["Best reply", esc(bestReply)],
  ];
  const notes = recapNotes(f.kind, f.health.problems);

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px">
  <h2 style="margin:0 0 2px;font-size:18px">${emoji} ${esc(headline)}</h2>
  <p style="color:#666;margin:0 0 16px">for ${esc(f.business)}${when ? ` · ${esc(when)}` : ""}</p>
  <table style="border-collapse:collapse;font-size:15px;width:100%">
    ${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0">${v}</td></tr>`).join("\n    ")}
  </table>
  ${quoted ? `<p style="margin:12px 0 0;color:#666;font-size:13px">Their message (in their words):</p><blockquote style="margin:4px 0 0;padding:10px 12px;border-left:3px solid #6366f1;background:#f5f5ff;font-size:15px">${esc(quoted)}</blockquote>` : ""}
  ${notes.length ? `<p style="margin:12px 0 0;font-size:14px;color:#444">${notes.map(esc).join("<br>")}</p>` : ""}
  <p style="margin:16px 0 0"><a href="${esc(f.link)}" style="background:#111;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:14px;display:inline-block">Open the call</a></p>
  <p style="color:#999;font-size:12px;margin-top:18px">The suggested reply is an AI draft — check it before you send. Sent by your AI receptionist · FrontDesk AI</p>
</div>`;

  const text = [
    `${headline} (${f.business}${when ? `, ${when}` : ""})`,
    "",
    `Who: ${[name, callback ? formatPhone(callback) : null].filter(Boolean).join(" · ") || "Unknown caller"}${differentCallback ? ` (called from ${formatPhone(callerId)})` : ""}`,
    `     ${customer}${upcoming ? ` · ${upcoming}` : ""}`,
    `Wants: ${wants}${requested ? ` (asked for: ${requested})` : ""}`,
    `Urgency: ${urgencyLabel}`,
    `Best reply: ${bestReply}`,
    quoted ? `\nTheir message: "${quoted}"` : "",
    notes.length ? `\n${notes.join("\n")}` : "",
    "",
    `Open the call: ${f.link}`,
    "",
    "The suggested reply is an AI draft — check it before you send.",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");

  const smsHead =
    f.kind === "message"
      ? `${urgent ? "🚨 URGENT — " : "📨 "}${f.business}: ${who}${name && callback ? ` (${formatPhone(callback)})` : ""} left a message`
      : f.kind === "transfer"
        ? `${urgent ? "🚨 URGENT — " : "📞 "}${f.business}: ${who}${name && callback ? ` (${formatPhone(callback)})` : ""} was transferred`
        : `${urgent ? "🚨" : "⚠️"} ${f.business}: ${who}${name && callback ? ` (${formatPhone(callback)})` : ""} tried to reach a person and didn't — call back`;
  const smsWants = clean(wants, 90);
  const sms = `${smsHead}${smsWants && !smsWants.startsWith("Not stated") ? ` — ${smsWants}` : ""}. ${f.link}`;

  return { urgent, subject, html, text, sms };
}
