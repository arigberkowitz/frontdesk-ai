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

/** The ten digits you key in after a code. Landline/VoIP switches reject a leading +1. */
function tenDigits(aiNumber: string): string {
  const bare = aiNumber.replace(/\D/g, "");
  return bare.length === 11 && bare.startsWith("1") ? bare.slice(1) : bare;
}

export function forwardingCodes(mode: ForwardMode, aiNumber: string): ForwardingCodes {
  const pretty = formatPhone(aiNumber);
  const ten = tenDigits(aiNumber);
  const b = (s: string) => `<strong>${s}</strong>`;
  if (mode === "missed_only") {
    const on = (f: (s: string) => string) =>
      `From your business phone, dial ${f(`*90 ${pretty}`)} (forwards when you're on the line), then ${f(`*92 ${pretty}`)} (forwards when you don't pick up). Verizon mobile: just ${f(`*71 ${pretty}`)}. AT&T: ${f(`**67*${ten}#`)} and ${f(`**61*${ten}#`)}. T-Mobile: ${f(`**67*1${ten}#`)} and ${f(`**61*1${ten}#`)}. Not working? Call your carrier and say: "Forward my busy and unanswered calls to ${pretty}."`;
    return {
      turnOn: on((s) => s),
      turnOnHtml: on(b).replace(/&(?!lt;|gt;|amp;)/g, "&amp;"),
      turnOff: "Undo any time with *91 and *93 (Verizon mobile: *73; AT&T/T-Mobile: ##67# and ##61#).",
      short: `dial *90 ${pretty} then *92 ${pretty} (Verizon mobile: *71 ${pretty}; AT&T: **67*${ten}# and **61*${ten}#; T-Mobile: **67*1${ten}# and **61*1${ten}#)`,
    };
  }
  const on = (f: (s: string) => string) =>
    `From your business phone, dial ${f(`*72 ${pretty}`)}, wait for the confirmation tone, and hang up. AT&T: ${f(`**21*${ten}#`)}. T-Mobile: ${f(`**21*1${ten}#`)}.`;
  return {
    turnOn: on((s) => s),
    turnOnHtml: on(b).replace(/&(?!lt;|gt;|amp;)/g, "&amp;"),
    turnOff: "Undo any time with *73 (AT&T/T-Mobile: ##21#).",
    short: `dial *72 ${pretty} (AT&T: **21*${ten}#; T-Mobile: **21*1${ten}#)`,
  };
}

/**
 * One way of turning forwarding on and off, for the big callout at the top of
 * the Phone & AI card. `dial` is what you key in after a star code (10 digits,
 * no +1: landline/VoIP switches reject a leading +1). `gsm` is the international
 * form AT&T and T-Mobile expect. Every code here is on the carrier's own help
 * page (see forwarding-guides.ts for the links).
 */
export interface CodeVariant {
  id: string;
  /** Who this applies to, in words an owner recognises. */
  who: string;
  /** Each step is a code to dial, with a short label for what it does. */
  on: { label: string; seq: string; show: string }[];
  off: { label: string; seq: string; show: string }[];
}

export function forwardingVariants(mode: ForwardMode, aiNumber: string): CodeVariant[] {
  const ten = tenDigits(aiNumber);
  const pretty = formatPhone(aiNumber);
  const c = (label: string, seq: string, show: string) => ({ label, seq, show });
  // AT&T takes the plain ten digits; T-Mobile's own page writes 1 + ten digits.
  if (mode === "missed_only") {
    return [
      {
        id: "landline",
        who: "Office or landline phones (most)",
        on: [
          c("When busy", `*90${ten}`, `*90 ${pretty}`),
          c("When no answer", `*92${ten}`, `*92 ${pretty}`),
        ],
        off: [c("Busy off", "*91", "*91"), c("No answer off", "*93", "*93")],
      },
      {
        id: "verizon-mobile",
        who: "Verizon mobile",
        on: [c("Busy or no answer", `*71${ten}`, `*71 ${pretty}`)],
        off: [c("Turn off", "*73", "*73")],
      },
      {
        id: "att",
        who: "AT&T",
        on: [
          c("When busy", `**67*${ten}#`, `**67*${ten}#`),
          c("When no answer", `**61*${ten}#`, `**61*${ten}#`),
        ],
        off: [c("Busy off", "##67#", "##67#"), c("No answer off", "##61#", "##61#")],
      },
      {
        id: "tmobile",
        who: "T-Mobile",
        on: [
          c("When busy", `**67*1${ten}#`, `**67*1${ten}#`),
          c("When no answer", `**61*1${ten}#`, `**61*1${ten}#`),
        ],
        off: [c("Busy off", "##67#", "##67#"), c("No answer off", "##61#", "##61#")],
      },
    ];
  }
  return [
    {
      id: "star",
      who: "Verizon, office or landline phones",
      on: [c("Forward every call", `*72${ten}`, `*72 ${pretty}`)],
      off: [c("Turn off", "*73", "*73")],
    },
    {
      id: "att",
      who: "AT&T",
      on: [c("Forward every call", `**21*${ten}#`, `**21*${ten}#`)],
      off: [c("Turn off", "##21#", "##21#")],
    },
    {
      id: "tmobile",
      who: "T-Mobile",
      on: [c("Forward every call", `**21*1${ten}#`, `**21*1${ten}#`)],
      off: [c("Turn off", "##21#", "##21#")],
    },
  ];
}
