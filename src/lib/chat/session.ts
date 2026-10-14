/**
 * The shape of a chat conversation as the widget sends it back to us.
 *
 * The browser holds the transcript and posts the whole thing each turn. That
 * keeps the server stateless and the widget droppable onto any site with no
 * cookies, but it means the transcript is attacker-controlled input. These
 * functions are the fence: they decide what of it we'll accept.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Most turns we'll replay. Beyond this the model sees the tail. */
export const MAX_TURNS = 30;
/** Longest single message we'll accept, in characters. */
export const MAX_MESSAGE_CHARS = 2_000;
/** How many tool calls one visitor message may trigger before we stop. */
export const MAX_TOOL_ROUNDS = 6;

/**
 * Reduce whatever the browser sent to a clean alternating transcript.
 *
 * Drops anything that isn't a user/assistant string turn, truncates long
 * messages, collapses runs of the same role (the model API requires
 * alternation), keeps only the most recent MAX_TURNS, and guarantees the
 * result ends with a user turn — the one we're answering.
 */
export function sanitizeTurns(input: unknown): ChatTurn[] | null {
  if (!Array.isArray(input)) return null;
  const clean: ChatTurn[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const role = (raw as { role?: unknown }).role;
    const content = (raw as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const text = content.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text) continue;
    const last = clean[clean.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n${text}`.slice(0, MAX_MESSAGE_CHARS);
    } else {
      clean.push({ role, content: text });
    }
  }
  // The model needs a user turn to answer; a transcript ending in our own
  // words has nothing to respond to.
  while (clean.length && clean[clean.length - 1].role === "assistant") clean.pop();
  // Keep the tail, then make sure the tail still opens on the visitor — the
  // model API rejects a conversation whose first message is the assistant's.
  const tail = clean.slice(-MAX_TURNS);
  while (tail.length && tail[0].role === "assistant") tail.shift();
  return tail.length ? tail : null;
}

/**
 * Which origins may call the chat endpoint.
 *
 * The widget lives on other people's websites, so the browser sends a
 * cross-origin request and we have to say yes to it. We echo the caller's
 * origin rather than `*` because `*` is not allowed alongside credentials and
 * because an explicit echo is easier to tighten to a per-client allowlist later
 * without changing the widget.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "access-control-allow-origin": origin && origin !== "null" ? origin : "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

/**
 * True when a reply announces a code send ("Let me send a verification code to
 * …") — the model said it would act but called no tool. Prod, Oct 14 2026:
 * Riley said exactly that, cancel_appointment never ran, no text went out.
 */
export function promisesCodeSend(text: string): boolean {
  return /\b(let me|i'll|i will|i'm|i am|i've|i have|i just|now)\b[^.?!]{0,20}\b(send|sending|sent|text|texting|texted|email|emailing|emailed)\b[^.?!]{0,60}\bcode\b/i.test(text);
}

/** The actions a reply can claim are done. */
export type ClaimKind = "booked" | "cancelled" | "rescheduled" | "sent";

const CLAIMS: Array<[ClaimKind, RegExp]> = [
  [
    "rescheduled",
    /\b(appointment|booking|it|you|you're|you've|i've|i have|i just|all)\b[^.?!]{0,30}\b(rescheduled|moved)\b/i,
  ],
  [
    "cancelled",
    /\b(appointment|booking|it|it's|that's|you're|you are|i've|i have|i just|all|been|successfully)\b[^.?!]{0,30}\bcancel+ed\b/i,
  ],
  [
    "booked",
    /\b(you're|you are|you've been|i've|i have|i just|all set|appointment|booking)\b[^.?!]{0,30}\b(booked|scheduled|confirmed)\b/i,
  ],
  [
    "sent",
    /\b(i've|i have|i just|i'?ve just|has been|have been|was|were)\b[^.?!]{0,25}\b(sent|texted|emailed|passed|forwarded)\b/i,
  ],
];

/**
 * Which completed action a reply asserts, if any. Questions and offers ("Want
 * me to cancel it?", "Should I book 10 AM?") are not claims.
 *
 * Prod, Oct 14 2026: the visitor typed their cancel code, Riley replied
 * "Got it. Your appointment has been cancelled." with no tool call. Nothing
 * was cancelled. Every such claim must now be backed by a tool result.
 */
export function successClaim(text: string): ClaimKind | null {
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const s = sentence.trim();
    if (!s || s.endsWith("?")) continue;
    if (/\b(would you like|want me to|shall i|should i|i can|i could|if you'd like|if you want)\b/i.test(s)) continue;
    // "Not cancelled", "couldn't book": honest failure, not a claim.
    if (/\b(not|n't|unable|couldn't|wasn't|isn't|failed)\b/i.test(s)) continue;
    for (const [kind, re] of CLAIMS) if (re.test(s)) return kind;
  }
  // "Let me send a code…" is a promise to act right now; treat it like a claim.
  if (promisesCodeSend(text)) return "sent";
  return null;
}

/**
 * Which claims a tool result backs. Only an explicit `success: true` (or a
 * code that really went out) counts; anything else confirms nothing.
 */
export function confirmedBy(toolName: string, output: string): ClaimKind[] {
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(output) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!r || typeof r !== "object") return [];
  const ok = r.success === true;
  switch (toolName) {
    case "cancel_appointment":
      if (ok) return ["cancelled", "sent"];
      // "unknown" is the privacy-preserving answer: a code may have gone out.
      return r.code_sent === true || r.code_sent === "unknown" ? ["sent"] : [];
    case "book_appointment":
      return ok ? ["booked", "rescheduled", "sent"] : [];
    case "take_message":
      return ok ? ["sent"] : [];
    default:
      return [];
  }
}

/** The tool to force when a reply claims `kind` without having done it. */
export function toolForClaim(kind: ClaimKind, text: string): string {
  switch (kind) {
    case "cancelled":
      return "cancel_appointment";
    case "booked":
    case "rescheduled":
      return "book_appointment";
    case "sent":
      return /\bcode\b/i.test(text) ? "cancel_appointment" : "take_message";
  }
}

/** What to say instead when a claim can't be backed by a tool result. */
export function unconfirmedReply(kind: ClaimKind): string {
  switch (kind) {
    case "cancelled":
      return "Sorry, I couldn't confirm the cancellation went through, so your appointment may still be booked. Please type the code again, or call the business directly.";
    case "booked":
      return "Sorry, I couldn't confirm that booking went through, so you're not booked yet. Want me to try again, or take a message for the team?";
    case "rescheduled":
      return "Sorry, I couldn't confirm the change went through, so your appointment hasn't moved yet. Want me to try again, or take a message for the team?";
    case "sent":
      return "Sorry, that didn't go through on my end, so nothing was sent. Want me to try again, or take a message for the team?";
  }
}

/**
 * The 6-digit code the visitor just typed, when the previous assistant turn
 * asked for one. Submitting a code must always reach cancel_appointment.
 */
export function submittedCode(turns: ChatTurn[]): string | null {
  const last = turns[turns.length - 1];
  const prev = turns[turns.length - 2];
  if (!last || last.role !== "user" || !prev || prev.role !== "assistant") return null;
  if (!/\bcode\b/i.test(prev.content)) return null;
  const m = last.content.replace(/[\s-]/g, "").match(/(?<!\d)\d{6}(?!\d)/);
  return m ? m[0] : null;
}
