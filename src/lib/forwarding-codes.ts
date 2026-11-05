import { formatPhone } from "@/lib/format";

/**
 * Carrier forwarding codes in plain words — the same codes and wording the
 * Settings → Phone & AI card shows (ai-number-card.tsx), so emails, texts and
 * the checklist never disagree with it. Missed-Call Rescue needs NO-ANSWER
 * forwarding: *72 forwards every call and silently turns a backup line into a
 * full-time receptionist.
 */
export type ForwardMode = "all_calls" | "missed_only" | string | null | undefined;

export interface ForwardingCodes {
  /** One sentence: how to turn forwarding on. Plain text. */
  turnOn: string;
  /** The same sentence with the codes in <strong>. Safe HTML (no user input). */
  turnOnHtml: string;
  /** One sentence: how to undo it. */
  turnOff: string;
  /** Short SMS-length version. */
  short: string;
}

export function forwardingCodes(mode: ForwardMode, aiNumber: string): ForwardingCodes {
  const pretty = formatPhone(aiNumber);
  const digits = aiNumber.replace(/[^\d+]/g, "");
  const b = (s: string) => `<strong>${s}</strong>`;
  if (mode === "missed_only") {
    const on = (f: (s: string) => string) =>
      `From your business phone, dial ${f(`*90 ${pretty}`)} (forwards when you're on the line), then ${f(`*92 ${pretty}`)} (forwards when you don't pick up). AT&T/T-Mobile: ${f(`**67*${digits}#`)} and ${f(`**61*${digits}#`)}. Not working? Call your carrier and say: "Forward my busy and unanswered calls to ${pretty}."`;
    return {
      turnOn: on((s) => s),
      turnOnHtml: on(b).replace(/&(?!lt;|gt;|amp;)/g, "&amp;"),
      turnOff: "Undo any time with *91 and *93 (AT&T/T-Mobile: ##67# and ##61#).",
      short: `dial *90 ${pretty} then *92 ${pretty} (AT&T/T-Mobile: **67*${digits}# and **61*${digits}#)`,
    };
  }
  const on = (f: (s: string) => string) =>
    `From your business phone, dial ${f(`*72 ${pretty}`)}, wait for the confirmation tone, and hang up. AT&T/T-Mobile: ${f(`**21*${digits}#`)}.`;
  return {
    turnOn: on((s) => s),
    turnOnHtml: on(b).replace(/&(?!lt;|gt;|amp;)/g, "&amp;"),
    turnOff: "Undo any time with *73 (AT&T/T-Mobile: ##21#).",
    short: `dial *72 ${pretty} (AT&T/T-Mobile: **21*${digits}#)`,
  };
}
