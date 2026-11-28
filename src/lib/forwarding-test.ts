import { normalizeForBlock } from "@/lib/spam";
import type { Client } from "@/db/schema";

/**
 * "Test my forwarding": the server rings the business's real line from one of
 * OUR numbers and watches for that call to arrive at the business's AI number
 * (Retell's inbound webhook). If it arrives, forwarding works.
 *
 * Everything here is pure or goes through `ForwardingTestDeps`, so the rules —
 * who may run it, the rate limit, what counts as a pass, what a failure means —
 * are tested without a phone, Twilio or a database.
 *
 * The test call is deliberately invisible to the rest of the product: it never
 * becomes a row in the call log, so no lead, no follow-up, no text, no usage
 * minutes and no billing can come from it. On arrival the Retell webhook turns
 * the call away (`reject`) before any agent or voice starts, so it costs
 * nothing at Retell either; the only cost is our outbound Twilio leg (pennies).
 *
 * The quiet-line alert (quiet-line.ts) points owners at this same test and
 * reads `forwardingVerifiedAt`, so there's one definition of "forwarding works".
 */

export type ForwardingTestMode = "all_calls" | "missed_only";
export type ForwardingTest = NonNullable<NonNullable<Client["setupFlags"]>["forwardingTest"]>;

/** How many tests one business may run per window. */
export const TEST_LIMIT = 5;
export const TEST_WINDOW_MS = 60 * 60_000;
/** The same destination across all businesses, so it can't be used to pester a line. */
export const TEST_LIMIT_PER_DESTINATION = 5;

/** How long we wait for the call to show up. Missed-call forwarding waits for the carrier's ring time. */
export const WAIT_MS: Record<ForwardingTestMode, number> = { all_calls: 45_000, missed_only: 90_000 };
/** Twilio keeps ringing this long before giving up (longer than any carrier's no-answer delay). */
export const RING_SECONDS: Record<ForwardingTestMode, number> = { all_calls: 30, missed_only: 60 };
/** A webhook can lag the poll; a pass that lands this late still counts. */
export const LATE_PASS_GRACE_MS = 60_000;
/** After a pass, further events of the same call (ended/analyzed) are still swallowed for this long. */
export const PASSED_SWALLOW_MS = 2 * 60_000;
/** Once our Twilio leg has ended, wait this long for a webhook before calling it a miss. */
export const AFTER_HANGUP_GRACE_MS = 8_000;

export const TEST_SPOKEN_MESSAGE =
  "This is a call forwarding test from Front Desk A I. There is nothing you need to do. You can hang up.";

export type TwilioLegStatus =
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "failed"
  | "no-answer"
  | "canceled";

export interface ClientForTest {
  id: string;
  name?: string | null;
  retellPhoneNumber: string | null;
  forwardingNumber: string | null;
  escalationNumber?: string | null;
  answeringMode: string | null;
  deletedAt?: Date | null;
  setupFlags: Client["setupFlags"] | null;
}

export interface ForwardingTestStore {
  getClient(clientId: string): Promise<ClientForTest | null>;
  /**
   * Atomically record `test` as the running test unless one is already running.
   * False means another test is in flight (a double-click, or two tabs).
   */
  claim(clientId: string, test: ForwardingTest, now: Date): Promise<boolean>;
  /** Overwrite fields on the stored test (call sid, failure). Guarded by test id. */
  patch(clientId: string, testId: string, patch: Partial<ForwardingTest>): Promise<void>;
  /** Mark passed + forwardingDone + forwardingVerifiedAt in one write. False if the id no longer matches. */
  markPassed(clientId: string, testId: string, matchedBy: "caller" | "business_line", now: Date): Promise<boolean>;
  /** Mark failed (never overwrites a pass). */
  markFailed(clientId: string, testId: string, reason: string, now: Date): Promise<boolean>;
  /** Times this business started a test since `since` (the audit log), oldest first. */
  runsSince(clientId: string, since: Date): Promise<Date[]>;
  /** How many tests anywhere dialed this number since `since`. */
  runsToNumberSince(e164: string, since: Date): Promise<number>;
  /** The receipt. Written BEFORE the call is placed, so a failed call still counts toward the limit. */
  logPlaced(clientId: string, actor: string, detail: Record<string, unknown>): Promise<void>;
  logResult(clientId: string, detail: Record<string, unknown>): Promise<void>;
}

export interface ForwardingTestDeps {
  store: ForwardingTestStore;
  /** The number we dial FROM, or null when voice calling isn't set up. */
  fromNumber: string | null;
  now(): Date;
  newId(): string;
  placeCall(args: { to: string; from: string; ringSeconds: number }): Promise<{ sid: string }>;
  /** Our Twilio leg's status, for telling WHY a test missed. Null if unknown. */
  fetchCallStatus(sid: string): Promise<{ status: TwilioLegStatus; endedAt: Date | null } | null>;
}

const modeOf = (answeringMode: string | null | undefined): ForwardingTestMode =>
  answeringMode === "missed_only" ? "missed_only" : "all_calls";

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeForBlock(a);
  return Boolean(x) && x === normalizeForBlock(b);
}

/** When the next test is allowed, given the runs in the last window (pure). */
export function rateLimitState(
  runs: Date[],
  now: Date,
  limit = TEST_LIMIT,
  windowMs = TEST_WINDOW_MS,
): { ok: boolean; retryAfterSec: number } {
  const recent = runs.filter((d) => now.getTime() - d.getTime() < windowMs).sort((a, b) => a.getTime() - b.getTime());
  if (recent.length < limit) return { ok: true, retryAfterSec: 0 };
  const frees = recent[recent.length - limit].getTime() + windowMs;
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil((frees - now.getTime()) / 1000)) };
}

export function formatWait(sec: number): string {
  if (sec >= 90) return `${Math.ceil(sec / 60)} minutes`;
  if (sec >= 60) return "a minute";
  return `${sec} seconds`;
}

export type StartResult =
  | { ok: true; test: ForwardingTest; waitMs: number }
  | { ok: false; code: StartErrorCode; error: string };

export type StartErrorCode =
  | "not_configured"
  | "no_client"
  | "no_ai_number"
  | "no_business_line"
  | "same_number"
  | "rate_limited"
  | "destination_limited"
  | "already_running"
  | "call_failed";

const fail = (code: StartErrorCode, error: string): StartResult => ({ ok: false, code, error });

/**
 * Place the test call. The caller has already proven the user may act on this
 * client (owner or operator) — this function enforces everything else.
 */
export async function startForwardingTest(
  deps: ForwardingTestDeps,
  input: { clientId: string; actorId: string },
): Promise<StartResult> {
  const { store } = deps;
  const now = deps.now();
  if (!deps.fromNumber) {
    return fail("not_configured", "Forwarding tests aren't switched on for this account yet. Ask support and we'll turn it on.");
  }
  const client = await store.getClient(input.clientId);
  if (!client || client.deletedAt) return fail("no_client", "Business not found.");
  if (!client.retellPhoneNumber) {
    return fail("no_ai_number", "Your AI doesn't have its own phone number yet, so there's nothing to forward to.");
  }
  const to = toDialable(client.forwardingNumber);
  if (!to) {
    return fail("no_business_line", "Enter your business phone number first, the one customers call. That's the line we test.");
  }
  if (samePhone(to, client.retellPhoneNumber) || samePhone(to, deps.fromNumber)) {
    return fail("same_number", "That's the AI's own number. Enter the business number customers call instead.");
  }

  // Limits are checked BEFORE claiming, and the receipt is written BEFORE the
  // call, so a Twilio failure still uses up an attempt and a retry loop can't
  // become a pager.
  const since = new Date(now.getTime() - TEST_WINDOW_MS);
  const limit = rateLimitState(await store.runsSince(client.id, since), now);
  if (!limit.ok) {
    return fail(
      "rate_limited",
      `That's ${TEST_LIMIT} tests in the last hour. Try again in ${formatWait(limit.retryAfterSec)}.`,
    );
  }
  if ((await store.runsToNumberSince(to, since)) >= TEST_LIMIT_PER_DESTINATION) {
    return fail("destination_limited", "This number has been tested a lot in the last hour. Try again later.");
  }

  const mode = modeOf(client.answeringMode);
  const test: ForwardingTest = {
    id: deps.newId(),
    status: "pending",
    startedAt: now.toISOString(),
    mode,
    callerNumber: deps.fromNumber,
    dialed: to,
  };
  if (!(await store.claim(client.id, test, now))) {
    return fail("already_running", "A test is already running. Give it a minute to finish.");
  }

  await store.logPlaced(client.id, input.actorId, { to, from: deps.fromNumber, mode, testId: test.id });
  try {
    const { sid } = await deps.placeCall({ to, from: deps.fromNumber, ringSeconds: RING_SECONDS[mode] });
    test.callSid = sid;
    await store.patch(client.id, test.id, { callSid: sid });
  } catch (err) {
    await store.markFailed(client.id, test.id, "dial_failed", deps.now());
    await store.logResult(client.id, {
      testId: test.id,
      result: "failed",
      reason: "dial_failed",
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
    return fail("call_failed", "We couldn't place the test call. Check the business number is right and try again in a minute.");
  }
  return { ok: true, test, waitMs: WAIT_MS[mode] };
}

/** US numbers as typed -> E.164, or null. (Kept here so this file has no format.ts dependency in tests.) */
function toDialable(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/* --------------------------------- results -------------------------------- */

export interface ForwardingTestView {
  id: string;
  status: "pending" | "passed" | "failed";
  mode: ForwardingTestMode;
  headline: string;
  detail: string;
  /** Plain next steps when it didn't pass. */
  steps: string[];
  /** ms left before the wait runs out (pending only). */
  remainingMs: number;
  verifiedAt?: string;
}

export type FailReason = "answered" | "no_answer" | "busy" | "dial_failed" | "timeout";

/** What a miss means, in words an owner can act on. Mode-aware. */
export function describeMiss(
  reason: FailReason,
  mode: ForwardingTestMode,
): { headline: string; detail: string; steps: string[] } {
  const missed = mode === "missed_only";
  const turnOn = missed
    ? "Turn on busy and no-answer forwarding with the codes at the top of this card, or the steps for your phone service below."
    : "Turn forwarding on with the codes at the top of this card, or the steps for your phone service below.";
  const retry = "Then tap Test my forwarding again.";
  switch (reason) {
    case "answered":
      return missed
        ? {
            headline: "Your line answered, so nothing was forwarded",
            detail:
              "In Only calls you miss mode this test only passes when nobody picks up. Your phone, a person, or your voicemail answered the call before it could forward.",
            steps: [
              "Let the test ring: don't pick up when it comes in, and don't let voicemail answer first.",
              "If voicemail answers, forwarding to the AI needs to kick in before it does. Ask your provider to shorten the ring time before voicemail, or turn voicemail off.",
              turnOn,
              retry,
            ],
          }
        : {
            headline: "Your business line answered instead of forwarding",
            detail:
              "Someone or something (a person, an answering machine, or voicemail) picked up your business number. Forwarding looks like it's off, or it's going somewhere other than your AI number.",
            steps: [
              "Make sure you're not picking up while the test runs.",
              turnOn,
              "Check the number you forwarded to is exactly the AI number shown above.",
              retry,
            ],
          };
    case "no_answer":
      return missed
        ? {
            headline: "It rang, but didn't reach your AI",
            detail:
              "Nobody picked up, which is what this mode needs, but the call never arrived at your AI number. No-answer forwarding is probably off, or it hasn't kicked in after the rings we allow.",
            steps: [
              turnOn,
              "If your phone rings a long time before forwarding, ask your provider to shorten the ring time. We wait about 90 seconds.",
              retry,
            ],
          }
        : {
            headline: "It rang, but didn't reach your AI",
            detail: "The business line rang and nobody answered. The call never arrived at your AI number, so forwarding isn't on yet.",
            steps: [turnOn, "Check the number you forwarded to is exactly the AI number shown above.", retry],
          };
    case "busy":
      return {
        headline: "Your business line was busy",
        detail: "The line was in use, so we couldn't tell whether forwarding works.",
        steps: ["Try again when the line is free.", retry],
      };
    case "dial_failed":
      return {
        headline: "We couldn't reach that number",
        detail: "The call to your business number didn't go through. The number may be mistyped, or your carrier blocked the call.",
        steps: [
          "Check the business phone number above is the full number with area code.",
          "Some providers block calls from unknown numbers. Ask yours to allow them.",
          retry,
        ],
      };
    default:
      return {
        headline: "The test call didn't reach your AI",
        detail: "We waited, and no call arrived at your AI number.",
        steps: [turnOn, "Check the number you forwarded to is exactly the AI number shown above.", retry],
      };
  }
}

export function describePass(mode: ForwardingTestMode): { headline: string; detail: string } {
  return mode === "missed_only"
    ? {
        headline: "Passed: a call you didn't pick up reached your AI",
        detail: "Forwarding is working. Calls you miss will be answered by your AI.",
      }
    : {
        headline: "Passed: a call to your business number reached your AI",
        detail: "Forwarding is working. Customers who call your business number now get your AI.",
      };
}

export function viewOf(test: ForwardingTest, now: Date, verifiedAt?: string): ForwardingTestView {
  const waitMs = WAIT_MS[test.mode];
  const remainingMs = Math.max(0, new Date(test.startedAt).getTime() + waitMs - now.getTime());
  if (test.status === "passed") {
    return { id: test.id, status: "passed", mode: test.mode, ...describePass(test.mode), steps: [], remainingMs: 0, verifiedAt };
  }
  if (test.status === "failed") {
    return {
      id: test.id,
      status: "failed",
      mode: test.mode,
      ...describeMiss((test.reason as FailReason) ?? "timeout", test.mode),
      remainingMs: 0,
    };
  }
  return {
    id: test.id,
    status: "pending",
    mode: test.mode,
    headline: test.mode === "missed_only" ? "Calling your business line. Don't pick up." : "Calling your business line…",
    detail:
      test.mode === "missed_only"
        ? "Let it ring. The test passes when the call forwards to your AI after your phone goes unanswered. This can take up to a minute and a half."
        : "Your business phone may ring once. You don't need to answer.",
    steps: [],
    remainingMs,
  };
}

function reasonFromTwilio(status: TwilioLegStatus | undefined): FailReason {
  switch (status) {
    case "completed":
    case "in-progress":
      return "answered";
    case "no-answer":
      return "no_answer";
    case "busy":
      return "busy";
    case "failed":
    case "canceled":
      return "dial_failed";
    default:
      return "timeout";
  }
}

/**
 * The poll behind the Pass/Fail screen. Reads the stored test; if it's still
 * pending, decides whether it has missed (the wait ran out, or our leg ended and
 * nobody arrived), asking Twilio what happened so the advice fits.
 */
export async function pollForwardingTest(
  deps: ForwardingTestDeps,
  clientId: string,
  testId: string,
): Promise<ForwardingTestView | null> {
  const now = deps.now();
  const client = await deps.store.getClient(clientId);
  const test = client?.setupFlags?.forwardingTest;
  if (!client || !test || test.id !== testId) return null;
  if (test.status !== "pending") {
    return viewOf(test, now, client.setupFlags?.forwardingVerifiedAt);
  }

  const started = new Date(test.startedAt).getTime();
  const waitMs = WAIT_MS[test.mode];
  const elapsed = now.getTime() - started;
  let reason: FailReason | null = null;

  // Ask Twilio how our leg ended. If it's over and the grace passed with no
  // arrival, the call isn't coming.
  let leg: Awaited<ReturnType<ForwardingTestDeps["fetchCallStatus"]>> = null;
  if (test.callSid && elapsed > 6_000) {
    try {
      leg = await deps.fetchCallStatus(test.callSid);
    } catch {
      leg = null;
    }
  }
  const ended = leg && ["completed", "busy", "failed", "no-answer", "canceled"].includes(leg.status);
  if (ended && leg) {
    const endedAt = leg.endedAt?.getTime() ?? now.getTime();
    if (now.getTime() - endedAt >= AFTER_HANGUP_GRACE_MS) reason = reasonFromTwilio(leg.status);
  }
  if (!reason && elapsed >= waitMs) reason = reasonFromTwilio(leg?.status ?? undefined);

  if (!reason) return viewOf(test, now);

  const changed = await deps.store.markFailed(clientId, test.id, reason, now);
  if (changed) {
    await deps.store.logResult(clientId, { testId: test.id, result: "failed", reason, twilio: leg?.status ?? null });
  }
  // A pass may have landed between our read and our write; show the truth.
  const fresh = (await deps.store.getClient(clientId))?.setupFlags;
  const final = fresh?.forwardingTest;
  return final ? viewOf(final, now, fresh?.forwardingVerifiedAt) : null;
}

/* ------------------------------ inbound match ----------------------------- */

/**
 * Is this incoming call our own test call? Called by the Retell webhook for
 * every call before anything else, so a test is turned away before an agent
 * starts and never reaches the call log.
 *
 * Matches the number the call came from against the number we dialed FROM
 * (carriers normally keep the original caller on a forwarded call) and, as a
 * fallback for carriers that replace it, the business line we dialed (forwarded
 * calls then show up as coming from it). Only while a test is running, or
 * within a short grace after it, and never for a suspended business.
 */
export function matchInboundTestCall(
  client: Pick<ClientForTest, "setupFlags">,
  fromNumber: string | null | undefined,
  now: Date,
): { matched: false } | { matched: true; test: ForwardingTest; by: "caller" | "business_line"; alreadyPassed: boolean } {
  const test = client.setupFlags?.forwardingTest;
  if (!test || client.setupFlags?.suspended?.mode === "off") return { matched: false };
  const by = samePhone(fromNumber, test.callerNumber)
    ? "caller"
    : samePhone(fromNumber, test.dialed)
      ? "business_line"
      : null;
  if (!by) return { matched: false };

  const started = new Date(test.startedAt).getTime();
  const finished = test.finishedAt ? new Date(test.finishedAt).getTime() : null;
  const t = now.getTime();
  let live: boolean;
  if (test.status === "pending") live = t <= started + WAIT_MS[test.mode] + LATE_PASS_GRACE_MS;
  else if (test.status === "failed") live = finished !== null && t <= finished + LATE_PASS_GRACE_MS;
  else live = finished !== null && t <= finished + PASSED_SWALLOW_MS;
  if (!live) return { matched: false };
  return { matched: true, test, by, alreadyPassed: test.status === "passed" };
}

/**
 * Webhook entry point. Returns true when the call was our test (so the caller
 * must not treat it as a customer call). Records the pass the first time.
 */
export async function claimInboundTestCall(
  store: ForwardingTestStore,
  client: ClientForTest,
  fromNumber: string | null | undefined,
  now: Date,
): Promise<boolean> {
  const m = matchInboundTestCall(client, fromNumber, now);
  if (!m.matched) return false;
  if (!m.alreadyPassed) {
    const wrote = await store.markPassed(client.id, m.test.id, m.by, now);
    if (wrote) {
      await store.logResult(client.id, { testId: m.test.id, result: "passed", matchedBy: m.by });
    }
  }
  return true;
}
