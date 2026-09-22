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
