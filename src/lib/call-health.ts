/**
 * What went wrong on a call — the half of the story every competitor omits.
 *
 * The market reports "calls answered." One vendor publishes, from 1.4 million
 * calls, that 99% of callers were positive or neutral — a score produced by the
 * same class of model that ran the calls. Meanwhile 44% of consumers say they
 * try to escape a phone bot by asking for a human, and a restaurant owner who
 * read his own logs found customers swearing at it.
 *
 * So: hang-ups in the first few seconds, callers who asked for a person and
 * didn't get one, questions the agent had to ask three times, and calls that
 * ended with no way to ring anybody back — all of it currently rolls up into
 * "handled." Here it's separated out, named, and shown to the business.
 *
 * Deliberately rule-based rather than model-scored. A business should not have
 * to trust our model's opinion of our own model's work; these are countable
 * facts about a transcript, and the business can click through to the recording
 * and check any one of them.
 *
 * Pure and client-safe so the rules are testable without a database.
 */

export type CallProblem =
  /** Caller asked for a person. Whether they got one is `escaped` vs `strandedAskingForHuman`. */
  | "asked_for_human"
  /** Asked for a person and the call ended without reaching one. */
  | "stranded_asking_for_human"
  /** The agent asked for the same thing three or more times. */
  | "repeated_question"
  /** Caller hung up almost immediately — they heard a bot and left. */
  | "early_hangup"
  /** Call ended with no name and no number: nobody can follow this up. */
  | "no_contact_captured"
  /** Caller swore. Not proof of failure, but never a good sign. */
  | "caller_frustrated"
  /** Words that should never have reached a booking flow. */
  | "possible_emergency"
  /** We could not read this transcript, so we know nothing about this call. */
  | "unreadable"
  /** Disclosure is switched on for this business, but the agent didn't give it. */
  | "disclosure_missing";

export interface CallHealth {
  problems: CallProblem[];
  /** True when nothing needed a human's attention AND we could actually check. */
  clean: boolean;
  /**
   * Whether we could read the transcript well enough to judge it.
   *
   * This matters more than it looks. The speaker-label parsing below assumes a
   * shape; if a vendor changes it, every call silently comes back with no
   * problems and the business reads a clean bill of health we never actually
   * took. A product whose whole claim is honest reporting cannot have a failure
   * mode that manufactures good news. Unknown is reported as unknown.
   */
  readable: boolean;
  /** Short, plain-English lines to show the owner. One per problem. */
  notes: string[];
}

export interface CallHealthInput {
  transcript?: string | null;
  durationSec?: number | null;
  /** Our recorded outcome, if the post-call pipeline set one. */
  outcome?: string | null;
  /** Did we come away with any way to contact this caller? */
  hasContact?: boolean;
  /** Did a transfer to a human actually connect? */
  transferConnected?: boolean;
  /**
   * Whether this business expects the agent to disclose that it's an AI and
   * that the call may be recorded. When true, we check that it happened.
   */
  expectsDisclosure?: boolean;
}

/** Under this, the caller heard a greeting and left. */
const EARLY_HANGUP_SEC = 15;
/** Asking twice is a stumble. Three times is the thing people cancel over. */
const REPEAT_THRESHOLD = 3;

const HUMAN_REQUEST =
  /\b(real (person|human)|speak (to|with) (a|someone)|talk to (a|someone)|human|representative|receptionist|operator|manager|someone else|(is|are) (this|that|you) (a|an) ?(bot|robot|ai|recording|real person)?|am i talking to (a|an))\b/i;

const PROFANITY = /\b(fuck\w*|shit\w*|bullshit|goddamn|damn it|dammit|asshole|piss(ed)? off|stupid (bot|robot|machine|thing))\b/i;

/**
 * Words that mean "stop taking a booking and get a person now."
 *
 * Kept broad on purpose. A false positive costs one unnecessary alert; a false
 * negative is the call that ends with somebody's pipes flooded, or worse, and
 * it never shows up in a review — it shows up in a lawsuit.
 */
const EMERGENCY =
  /\b(emergency|urgent|right now|gas (leak|smell)|smell(s|ing)? gas|no heat|no water|flood(ing|ed)?|burst|leak(ing)? everywhere|fire|smoke|chest pain|can'?t breathe|bleeding|unconscious|ambulance|911|locked out|break[- ]?in|brok(e|en) ?in(to)?|accident|hit by|injur(y|ed)|in pain|swelling|knocked out)\b/i;

/**
 * Did the agent actually say it was an AI, and that the call may be recorded?
 *
 * Checked as two separate claims rather than matching the configured sentence,
 * because the agent paraphrases and a business can end up giving half the
 * disclosure without anyone noticing.
 *
 * This is the cheapest legal insurance in the product. A business whose calls
 * are transcribed and analyzed by third-party vendors, without the caller being
 * told, is the exact fact pattern in the California wiretapping suits now
 * running against AI call vendors — and it's the business that gets named
 * first, not us. Utah requires an honest answer on request; Maine requires
 * disclosure wherever a caller could reasonably think they're talking to a
 * person. Knowing which calls carried it, and being able to show it, is worth
 * more than any assurance we could write in a contract.
 */
export function disclosureGiven(agentSaid: string): { ai: boolean; recording: boolean } {
  return {
    ai: /\b(a\.?i\.?|artificial intelligence|virtual assistant|automated assistant|ai assistant|virtual receptionist|automated system)\b/i.test(
      agentSaid,
    ),
    recording: /\b(record(ed|ing)?|monitored|transcri(bed|ption))\b/i.test(agentSaid),
  };
}

/** Lines the agent spoke, lowercased and stripped of speaker labels. */
function agentLines(transcript: string): string[] {
  return transcript
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(agent|assistant|ai|bot)\s*[:\-]/i.test(l))
    .map((l) => l.replace(/^\w+\s*[:\-]\s*/, "").toLowerCase());
}

function callerLines(transcript: string): string[] {
  return transcript
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(user|caller|customer|human)\s*[:\-]/i.test(l))
    .map((l) => l.replace(/^\w+\s*[:\-]\s*/, ""));
}

/**
 * Which field a question is fishing for. Two askings of "what's your name?" and
 * "sorry, could I get your name again?" are the same question, and the caller
 * experiences them as the same question, so they have to count as one.
 */
function questionTopic(line: string): string | null {
  if (!line.includes("?")) return null;
  if (/\b(name)\b/.test(line)) return "name";
  if (/\b(address|street|where.*(located|live)|zip|postcode)\b/.test(line)) return "address";
  if (/\b(phone|number|reach you|call you back|mobile|cell)\b/.test(line)) return "phone";
  if (/\b(email|e-mail)\b/.test(line)) return "email";
  if (/\b(spell|spelling)\b/.test(line)) return "spelling";
  if (/\b(date|day|time|when)\b/.test(line)) return "when";
  if (/\b(service|what.*(need|looking for)|how can i help)\b/.test(line)) return "service";
  return null;
}

/** Count how many times the agent asked for each thing. */
export function repeatedTopics(transcript: string, threshold = REPEAT_THRESHOLD): string[] {
  const counts = new Map<string, number>();
  for (const line of agentLines(transcript)) {
    const topic = questionTopic(line);
    if (!topic) continue;
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .map(([topic]) => topic);
}

const TOPIC_LABEL: Record<string, string> = {
  name: "their name",
  address: "their address",
  phone: "their phone number",
  email: "their email",
  spelling: "a spelling",
  when: "a date or time",
  service: "what they needed",
};

export function analyzeCall(input: CallHealthInput): CallHealth {
  const transcript = input.transcript ?? "";
  const problems: CallProblem[] = [];
  const notes: string[] = [];

  const callerTurns = callerLines(transcript);
  const agentTurns = agentLines(transcript);
  // A call with words in it but no speaker labels we recognize means the format
  // changed under us. Duration alone still tells us about hang-ups, so keep
  // those checks — but say plainly that the rest is unknown.
  const readable = transcript.trim().length === 0 || callerTurns.length + agentTurns.length > 0;
  if (!readable) {
    problems.push("unreadable");
    notes.push("We couldn't read this transcript, so we haven't checked this call.");
  }

  const caller = callerTurns.join(" ");
  const askedForHuman = HUMAN_REQUEST.test(caller);
  const reachedHuman = input.transferConnected === true || input.outcome === "escalated";

  if (askedForHuman) {
    problems.push("asked_for_human");
    if (!reachedHuman) {
      problems.push("stranded_asking_for_human");
      notes.push("The caller asked for a person and the call ended without reaching one.");
    } else {
      notes.push("The caller asked for a person and was transferred.");
    }
  }

  const repeats = repeatedTopics(transcript);
  if (repeats.length) {
    problems.push("repeated_question");
    const listed = repeats.map((t) => TOPIC_LABEL[t] ?? t).join(" and ");
    notes.push(`Your AI had to ask for ${listed} three or more times.`);
  }

  // Spam is already junk; a two-second robocall isn't a customer walking away.
  const duration = input.durationSec ?? 0;
  if (duration > 0 && duration < EARLY_HANGUP_SEC && input.outcome !== "spam") {
    problems.push("early_hangup");
    notes.push(`The caller hung up after ${duration} seconds.`);
  }

  if (PROFANITY.test(caller)) {
    problems.push("caller_frustrated");
    notes.push("The caller swore during this call.");
  }

  if (EMERGENCY.test(caller)) {
    problems.push("possible_emergency");
    notes.push("The caller used words that may signal an emergency — worth listening to.");
  }

  // Disclosure only matters on a call long enough for anyone to have said it.
  // A four-second hang-up already has its own flag; adding a second one would
  // train the owner to ignore both.
  if (input.expectsDisclosure && readable && duration >= EARLY_HANGUP_SEC && agentTurns.length) {
    const given = disclosureGiven(agentTurns.join(" "));
    if (!given.ai || !given.recording) {
      problems.push("disclosure_missing");
      notes.push(
        !given.ai && !given.recording
          ? "Your AI didn't say it was an AI or mention recording on this call."
          : !given.ai
            ? "Your AI mentioned recording but never said it was an AI."
            : "Your AI said it was an AI but never mentioned that the call may be recorded.",
      );
    }
  }

  // Only a failure if there was a real conversation to capture something from.
  if (
    input.hasContact === false &&
    duration >= EARLY_HANGUP_SEC &&
    input.outcome !== "spam" &&
    input.outcome !== "faq_answered"
  ) {
    problems.push("no_contact_captured");
    notes.push("This call ended with no name or number — there's no way to follow up.");
  }

  return { problems, clean: problems.length === 0, readable, notes };
}

export interface CallHealthSummary {
  total: number;
  clean: number;
  /** Calls we could not read. Reported, never rounded down to "fine". */
  unreadable: number;
  askedForHuman: number;
  strandedAskingForHuman: number;
  repeatedQuestion: number;
  earlyHangup: number;
  noContactCaptured: number;
  callerFrustrated: number;
  possibleEmergency: number;
  /** Calls where the configured disclosure wasn't actually given. */
  disclosureMissing: number;
}

/** Roll a period's calls up into the counts a business should actually see. */
export function summarize(results: CallHealth[]): CallHealthSummary {
  const count = (p: CallProblem) => results.filter((r) => r.problems.includes(p)).length;
  return {
    total: results.length,
    clean: results.filter((r) => r.clean).length,
    unreadable: results.filter((r) => !r.readable).length,
    askedForHuman: count("asked_for_human"),
    strandedAskingForHuman: count("stranded_asking_for_human"),
    repeatedQuestion: count("repeated_question"),
    earlyHangup: count("early_hangup"),
    noContactCaptured: count("no_contact_captured"),
    callerFrustrated: count("caller_frustrated"),
    possibleEmergency: count("possible_emergency"),
    disclosureMissing: count("disclosure_missing"),
  };
}
