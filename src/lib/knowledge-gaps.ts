/**
 * Knowledge gaps: questions callers asked that the AI couldn't answer.
 *
 * The per-call detection is done by the post-call extraction (agents/extract.ts)
 * in the same model call that already reads every transcript, so it costs no
 * extra call. This module is the pure, client-safe half: cleaning what the
 * model returned, grouping similar questions, and rolling a period up into the
 * numbers the owner sees. Testable without a database.
 */

/** At most this many gap questions are kept per call. */
export const MAX_GAPS_PER_CALL = 3;
/** Stored questions are trimmed to this many characters. */
export const MAX_GAP_CHARS = 120;

const STOPWORDS = new Set(
  "a an the do does did you your yours is are was were can could would will i me my we our us to of for in on at it its this that and or if with have has any what how when where which who there be by from about".split(
    " ",
  ),
);

/** Lowercase, drop punctuation, collapse whitespace. The grouping key. */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The meaningful words of a question, for fuzzy matching. */
export function contentWords(q: string): Set<string> {
  return new Set(
    normalizeQuestion(q)
      .split(" ")
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      // Crude plural fold so "heater" and "heaters" count as one word.
      .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
  );
}

/** Share of content words two questions have in common (Jaccard, 0–1). */
export function similarity(a: string, b: string): number {
  const A = contentWords(a);
  const B = contentWords(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/** Two questions are "the same question" for grouping and matching. */
export function sameQuestion(a: string, b: string): boolean {
  const na = normalizeQuestion(a);
  const nb = normalizeQuestion(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return similarity(a, b) >= 0.75;
}

/**
 * Sanitize the model's list: trimmed, non-empty, no phone numbers or emails
 * (these are shown to the owner and grouped across callers, so they must be
 * generic), capped in length and count, de-duplicated.
 */
export function cleanGapQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    let q = item.replace(/\s+/g, " ").trim();
    if (!q) continue;
    // Never store contact details, even if the model slipped one in.
    if (/\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/.test(q) || /\S+@\S+\.\S+/.test(q)) continue;
    if (q.length > MAX_GAP_CHARS) q = `${q.slice(0, MAX_GAP_CHARS - 1).trimEnd()}…`;
    q = q.charAt(0).toUpperCase() + q.slice(1);
    if (out.some((o) => sameQuestion(o, q))) continue;
    out.push(q);
    if (out.length >= MAX_GAPS_PER_CALL) break;
  }
  return out;
}

export interface GapRow {
  callId: string;
  questions: string[];
}

export interface SuggestionRef {
  id: string;
  question: string | null;
  /** Calls the nightly loop drew this suggestion from. */
  callIds: string[];
}

export interface GapGroup {
  /** The wording shown to the owner: the most common phrasing in the group. */
  question: string;
  /** Distinct calls that asked it. */
  calls: number;
  callIds: string[];
  /** An open "Your AI learned" suggestion that would answer it, if any. */
  suggestionId: string | null;
  /** True once the knowledge base has an entry for it. */
  answered: boolean;
}

export interface GapSummary {
  /** Calls checked in the window (the denominator). */
  checked: number;
  /** Calls with at least one question the AI couldn't answer. */
  withGap: number;
  /** Whole-number percent of checked calls with a gap; 0 when nothing checked. */
  percent: number;
  /** Top questions, most-asked first. */
  top: GapGroup[];
}

/** Roll a window of checked calls up into the owner's numbers. */
export function summarizeGaps(
  rows: GapRow[],
  opts: { knowledgeQuestions?: string[]; suggestions?: SuggestionRef[]; limit?: number } = {},
): GapSummary {
  const limit = opts.limit ?? 5;
  const knowledge = opts.knowledgeQuestions ?? [];
  const suggestions = opts.suggestions ?? [];

  const checked = new Set(rows.map((r) => r.callId)).size;
  const gapCalls = new Set(rows.filter((r) => r.questions.length > 0).map((r) => r.callId));

  type Acc = { phrasings: Map<string, number>; callIds: Set<string>; first: string };
  const groups: Acc[] = [];
  for (const row of rows) {
    for (const q of row.questions) {
      const g = groups.find((x) => sameQuestion(x.first, q));
      if (g) {
        g.callIds.add(row.callId);
        g.phrasings.set(q, (g.phrasings.get(q) ?? 0) + 1);
      } else {
        groups.push({ first: q, callIds: new Set([row.callId]), phrasings: new Map([[q, 1]]) });
      }
    }
  }

  const top = groups
    .map((g) => {
      const question = [...g.phrasings.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const callIds = [...g.callIds];
      return {
        question,
        calls: callIds.length,
        callIds,
        suggestionId: matchSuggestion(question, callIds, suggestions),
        answered: knowledge.some((k) => sameQuestion(k, question)),
      };
    })
    .sort((a, b) => b.calls - a.calls || a.question.localeCompare(b.question))
    .slice(0, limit);

  return {
    checked,
    withGap: gapCalls.size,
    percent: checked > 0 ? Math.round((gapCalls.size / checked) * 100) : 0,
    top,
  };
}

/**
 * The open suggestion that answers this question: same question, or drawn from
 * one of the same calls AND sharing at least one meaningful word (a call can
 * have several gaps, so a shared call alone isn't enough).
 */
export function matchSuggestion(
  question: string,
  callIds: string[],
  suggestions: SuggestionRef[],
): string | null {
  const withQ = suggestions.filter((s) => s.question?.trim());
  const exact = withQ.find((s) => sameQuestion(s.question!, question));
  if (exact) return exact.id;
  const ids = new Set(callIds);
  const words = contentWords(question);
  const viaCall = withQ.find(
    (s) =>
      s.callIds.some((id) => ids.has(id)) &&
      [...contentWords(s.question!)].some((w) => words.has(w)),
  );
  return viaCall?.id ?? null;
}
