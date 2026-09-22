/**
 * "The moment it went wrong."
 *
 * A flagged call shouldn't hand the owner a nine-minute recording and a list
 * of reasons. It should point: *this* line, *here*. This module turns a call
 * into timed turns and picks the turn each health problem is about, so the
 * page can quote it, highlight it in the transcript, and scrub the recording
 * to it.
 *
 * Pure and client-safe — the rules are testable without a database.
 */

import {
  EMERGENCY,
  HUMAN_REQUEST,
  PROFANITY,
  questionTopic,
  TOPIC_LABEL,
  type CallProblem,
} from "@/lib/call-health";

export type TurnRole = "agent" | "user" | "other";

export interface Turn {
  role: TurnRole;
  /** Who spoke, as the transcript labelled them ("Agent", "User", "Transfer Target"). */
  speaker: string;
  text: string;
  /** Seconds into the recording, when the vendor gave us word timings. */
  startSec: number | null;
}

export interface Moment {
  /** Index into the turns array. */
  turnIndex: number;
  /** Which problem this moment illustrates. */
  problem: CallProblem;
  /** One line for the owner: what to listen for here. */
  label: string;
}

interface RetellWord {
  start?: number;
  end?: number;
}
interface RetellTurn {
  role?: string;
  content?: string;
  words?: RetellWord[];
}

function roleOf(label: string): TurnRole {
  if (/^(agent|assistant|ai|bot)$/i.test(label)) return "agent";
  if (/^(user|caller|customer|human)$/i.test(label)) return "user";
  return "other";
}

function prettySpeaker(role: TurnRole, raw: string, agentName?: string | null): string {
  if (role === "agent") return agentName?.trim() || "Your AI";
  if (role === "user") return "Caller";
  return raw;
}

/**
 * Retell's webhook payload carries `transcript_object`: one entry per turn
 * with per-word timings. We keep the whole payload, so timings are available
 * for every call it was sent for — nothing new had to be stored.
 */
function turnsFromPayload(raw: unknown, agentName?: string | null): Turn[] | null {
  if (!raw || typeof raw !== "object") return null;
  const call = (raw as { call?: unknown }).call;
  if (!call || typeof call !== "object") return null;
  const list = (call as { transcript_object?: unknown }).transcript_object;
  if (!Array.isArray(list) || list.length === 0) return null;

  const turns: Turn[] = [];
  for (const item of list as RetellTurn[]) {
    const text = (item.content ?? "").trim();
    if (!text) continue;
    const role = roleOf(item.role ?? "");
    const first = item.words?.find((w) => typeof w.start === "number");
    turns.push({
      role,
      speaker: prettySpeaker(role, item.role ?? "", agentName),
      text,
      startSec: first && typeof first.start === "number" ? Math.max(0, first.start) : null,
    });
  }
  return turns.length ? turns : null;
}

/** Fallback: the plain "Agent: … / User: …" transcript, no timings. */
function turnsFromText(transcript: string, agentName?: string | null): Turn[] {
  const turns: Turn[] = [];
  for (const rawLine of transcript.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^([A-Za-z][A-Za-z ]{0,20}?)\s*[:\-]\s*(.*)$/.exec(line);
    if (m && m[2].trim()) {
      const role = roleOf(m[1].trim());
      turns.push({ role, speaker: prettySpeaker(role, m[1].trim(), agentName), text: m[2].trim(), startSec: null });
    } else if (turns.length) {
      // A wrapped continuation of the previous turn.
      turns[turns.length - 1].text += ` ${line}`;
    } else {
      turns.push({ role: "other", speaker: "", text: line, startSec: null });
    }
  }
  return turns;
}

export function turnsForCall(
  call: { transcript: string | null; rawPayload: unknown },
  agentName?: string | null,
): Turn[] {
  return (
    turnsFromPayload(call.rawPayload, agentName) ??
    (call.transcript ? turnsFromText(call.transcript, agentName) : [])
  );
}

/** m:ss for a timestamp chip. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function firstUser(turns: Turn[], re: RegExp): number {
  return turns.findIndex((t) => t.role === "user" && re.test(t.text));
}
function lastIndex(turns: Turn[], pred: (t: Turn) => boolean): number {
  for (let i = turns.length - 1; i >= 0; i--) if (pred(turns[i])) return i;
  return -1;
}

/**
 * Pick the turn each problem points at, in the order the owner should meet
 * them (the ones a callback can still fix first). One moment per problem;
 * a problem with no locatable turn is left out rather than guessed.
 */
export function findMoments(problems: CallProblem[], turns: Turn[]): Moment[] {
  const out: Moment[] = [];
  const add = (turnIndex: number, problem: CallProblem, label: string) => {
    if (turnIndex < 0 || turnIndex >= turns.length) return;
    if (out.some((m) => m.turnIndex === turnIndex)) return;
    out.push({ turnIndex, problem, label });
  };

  for (const p of problems) {
    switch (p) {
      case "possible_emergency":
        add(firstUser(turns, EMERGENCY), p, "Where the caller said something that may be an emergency");
        break;
      case "stranded_asking_for_human":
      case "asked_for_human": {
        const i = firstUser(turns, HUMAN_REQUEST);
        // The interesting line is what the AI said *back*.
        const reply = i >= 0 ? turns.findIndex((t, j) => j > i && t.role === "agent") : -1;
        add(
          reply >= 0 ? reply : i,
          p,
          p === "stranded_asking_for_human"
            ? "The caller asked for a person — here's how your AI answered"
            : "Where the caller asked for a person",
        );
        break;
      }
      case "caller_frustrated":
        add(firstUser(turns, PROFANITY), p, "Where the caller got frustrated");
        break;
      case "repeated_question": {
        // The third time the AI asked for the same thing.
        const seen = new Map<string, number>();
        let hit = -1;
        let topic = "";
        for (let i = 0; i < turns.length && hit < 0; i++) {
          const t = turns[i];
          if (t.role !== "agent") continue;
          const k = questionTopic(t.text.toLowerCase());
          if (!k) continue;
          const n = (seen.get(k) ?? 0) + 1;
          seen.set(k, n);
          if (n >= 3) {
            hit = i;
            topic = k;
          }
        }
        add(hit, p, `The third time your AI asked for ${TOPIC_LABEL[topic] ?? "the same thing"}`);
        break;
      }
      case "transferred_to_voicemail":
      case "transfer_dropped":
        add(
          lastIndex(turns, (t) => t.role === "agent" && /\b(transfer|connect you|put you through|hold on|one moment)\b/i.test(t.text)),
          p,
          p === "transferred_to_voicemail"
            ? "Where the transfer started — it ended in voicemail"
            : "Where the transfer started — the call dropped right after",
        );
        break;
      case "disclosure_missing":
        add(
          turns.findIndex((t) => t.role === "agent"),
          p,
          "The greeting — this is where the AI and recording disclosure belongs",
        );
        break;
      case "early_hangup":
        add(lastIndex(turns, (t) => t.role === "agent"), p, "The last thing the caller heard before hanging up");
        break;
      case "no_contact_captured":
        add(lastIndex(turns, (t) => t.role === "agent"), p, "The call ended here without a name or number");
        break;
      case "unreadable":
        break;
    }
  }
  return out;
}
