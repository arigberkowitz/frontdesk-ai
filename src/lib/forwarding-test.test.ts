import { describe, expect, it, vi } from "vitest";
import {
  AFTER_HANGUP_GRACE_MS,
  LATE_PASS_GRACE_MS,
  PASSED_SWALLOW_MS,
  RING_SECONDS,
  TEST_LIMIT,
  TEST_WINDOW_MS,
  WAIT_MS,
  claimInboundTestCall,
  describeMiss,
  matchInboundTestCall,
  pollForwardingTest,
  rateLimitState,
  startForwardingTest,
  type ClientForTest,
  type ForwardingTest,
  type ForwardingTestDeps,
  type ForwardingTestStore,
  type TwilioLegStatus,
} from "./forwarding-test";

const T0 = new Date("2026-11-27T18:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

/** An in-memory stand-in for the database + Twilio, so no phone is ever dialed. */
function world(over: Partial<ClientForTest> = {}) {
  const state = {
    client: {
      id: "c1",
      retellPhoneNumber: "+12272382281",
      forwardingNumber: "+14155550100",
      answeringMode: "all_calls",
      setupFlags: {},
      ...over,
    } as ClientForTest,
    audits: [] as { clientId?: string; action: string; at: Date; detail: Record<string, unknown> }[],
    now: T0,
    calls: [] as { to: string; from: string; ringSeconds: number }[],
    leg: null as { status: TwilioLegStatus; endedAt: Date | null } | null,
    placeError: null as Error | null,
    // Everything that must NEVER happen from a test call.
    sideEffects: { leads: 0, texts: 0, usageMinutes: 0, callRows: 0 },
  };
  const flags = () => state.client.setupFlags!;
  const store: ForwardingTestStore = {
    getClient: async () => structuredClone(state.client),
    claim: async (_id, test, now) => {
      const cur = flags().forwardingTest;
      if (cur?.status === "pending" && now.getTime() - new Date(cur.startedAt).getTime() < WAIT_MS.missed_only + LATE_PASS_GRACE_MS) {
        return false;
      }
      flags().forwardingTest = { ...test };
      return true;
    },
    patch: async (_id, testId, patch) => {
      if (flags().forwardingTest?.id === testId) Object.assign(flags().forwardingTest!, patch);
    },
    markPassed: async (_id, testId, matchedBy, now) => {
      const t = flags().forwardingTest;
      if (!t || t.id !== testId || t.status === "passed") return false;
      delete t.reason;
      Object.assign(t, { status: "passed", finishedAt: now.toISOString(), matchedBy });
      flags().forwardingDone = true;
      flags().forwardingVerifiedAt = now.toISOString();
      return true;
    },
    markFailed: async (_id, testId, reason, now) => {
      const t = flags().forwardingTest;
      if (!t || t.id !== testId || t.status !== "pending") return false;
      Object.assign(t, { status: "failed", finishedAt: now.toISOString(), reason });
      return true;
    },
    runsSince: async (id, since) =>
      state.audits.filter((a) => a.clientId === id && a.action === "forwarding.test_placed" && a.at >= since).map((a) => a.at),
    runsToNumberSince: async (to, since) =>
      state.audits.filter((a) => a.action === "forwarding.test_placed" && a.at >= since && a.detail.to === to).length,
    logPlaced: async (id, _actor, detail) => void state.audits.push({ clientId: id, action: "forwarding.test_placed", at: state.now, detail }),
    logResult: async (_id, detail) => void state.audits.push({ action: "forwarding.test_result", at: state.now, detail }),
  };
  let n = 0;
  const deps: ForwardingTestDeps = {
    store,
    fromNumber: "+18885550001",
    now: () => state.now,
    newId: () => `t${++n}`,
    placeCall: async (a) => {
      if (state.placeError) throw state.placeError;
      state.calls.push(a);
      return { sid: "CA123" };
    },
    fetchCallStatus: async () => state.leg,
  };
  return { state, deps, flags };
}

describe("start: guards", () => {
  it("rings the saved business line from our number, with a short logged call", async () => {
    const w = world();
    const r = await startForwardingTest(w.deps, { clientId: "c1", actorId: "u1" });
    expect(r.ok).toBe(true);
    expect(w.state.calls).toEqual([{ to: "+14155550100", from: "+18885550001", ringSeconds: RING_SECONDS.all_calls }]);
    expect(w.flags().forwardingTest).toMatchObject({ status: "pending", dialed: "+14155550100", callSid: "CA123", mode: "all_calls" });
    expect(w.state.audits.filter((a) => a.action === "forwarding.test_placed")).toHaveLength(1);
  });

  it("waits longer in Only-calls-you-miss mode so the carrier's no-answer delay can pass", async () => {
    const w = world({ answeringMode: "missed_only" });
    const r = await startForwardingTest(w.deps, { clientId: "c1", actorId: "u1" });
    expect(r.ok && r.waitMs).toBe(WAIT_MS.missed_only);
    expect(w.state.calls[0].ringSeconds).toBe(RING_SECONDS.missed_only);
    expect(WAIT_MS.missed_only).toBeGreaterThan(WAIT_MS.all_calls);
  });

  it("asks for the business number when none is saved, and places no call", async () => {
    const w = world({ forwardingNumber: null });
    const r = await startForwardingTest(w.deps, { clientId: "c1", actorId: "u1" });
    expect(r).toMatchObject({ ok: false, code: "no_business_line" });
    expect(w.state.calls).toHaveLength(0);
  });

  it("refuses without an AI number, when voice isn't configured, or when the line is the AI's own number", async () => {
    expect(await startForwardingTest(world({ retellPhoneNumber: null }).deps, { clientId: "c1", actorId: "u" })).toMatchObject({ code: "no_ai_number" });
    const off = world();
    off.deps.fromNumber = null;
    expect(await startForwardingTest(off.deps, { clientId: "c1", actorId: "u" })).toMatchObject({ code: "not_configured" });
    const loop = world({ forwardingNumber: "(227) 238-2281" });
    expect(await startForwardingTest(loop.deps, { clientId: "c1", actorId: "u" })).toMatchObject({ code: "same_number" });
    expect(loop.state.calls).toHaveLength(0);
  });

  it("a double click doesn't place two calls", async () => {
    const w = world();
    expect((await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" })).ok).toBe(true);
    expect(await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" })).toMatchObject({ code: "already_running" });
    expect(w.state.calls).toHaveLength(1);
  });

  it("a failed dial still uses up an attempt and reports plainly", async () => {
    const w = world();
    w.state.placeError = new Error("Twilio 21215");
    const r = await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    expect(r).toMatchObject({ ok: false, code: "call_failed" });
    expect(w.state.audits.filter((a) => a.action === "forwarding.test_placed")).toHaveLength(1);
    expect(w.flags().forwardingTest?.status).toBe("failed");
  });
});

describe("rate limit", () => {
  it("allows five tests an hour per business, then says when the next is allowed", async () => {
    const w = world();
    for (let i = 0; i < TEST_LIMIT; i++) {
      w.state.now = at(i * 3 * 60_000); // three minutes apart: each previous wait has run out
      expect((await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" })).ok).toBe(true);
    }
    w.state.now = at(13 * 60_000);
    const r = await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    expect(r).toMatchObject({ ok: false, code: "rate_limited" });
    expect(!r.ok && r.error).toMatch(/Try again in 47 minutes/);
    expect(w.state.calls).toHaveLength(TEST_LIMIT);
    // An hour after the first one, it frees up.
    w.state.now = at(TEST_WINDOW_MS + 1000);
    expect((await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" })).ok).toBe(true);
  });

  it("also caps how often one destination can be rung across all businesses", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) {
      w.state.audits.push({ clientId: "other", action: "forwarding.test_placed", at: at(-60_000 * (i + 1)), detail: { to: "+14155550100" } });
    }
    const r = await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    expect(r).toMatchObject({ ok: false, code: "destination_limited" });
    expect(w.state.calls).toHaveLength(0);
  });

  it("rateLimitState is pure and exact", () => {
    const runs = [0, 1, 2, 3, 4].map((m) => at(m * 60_000));
    expect(rateLimitState(runs, at(5 * 60_000))).toEqual({ ok: false, retryAfterSec: 55 * 60 });
    expect(rateLimitState(runs.slice(0, 4), at(5 * 60_000)).ok).toBe(true);
  });
});

describe("arrival: pass", () => {
  it("a call from our test number to the AI number passes, switches forwarding on and stamps the time", async () => {
    const w = world();
    await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    w.state.now = at(7000);
    const hit = await claimInboundTestCall(w.deps.store, w.state.client, "+18885550001", w.state.now);
    expect(hit).toBe(true);
    expect(w.flags().forwardingDone).toBe(true);
    expect(w.flags().forwardingVerifiedAt).toBe(w.state.now.toISOString());
    const view = await pollForwardingTest(w.deps, "c1", "t1");
    expect(view).toMatchObject({ status: "passed", verifiedAt: w.state.now.toISOString() });
  });

  it("matches when the carrier shows the forwarded call as coming from the business line", () => {
    const test: ForwardingTest = { id: "t", status: "pending", startedAt: T0.toISOString(), mode: "all_calls", callerNumber: "+18885550001", dialed: "+14155550100" };
    const c = { setupFlags: { forwardingTest: test } };
    expect(matchInboundTestCall(c, "(415) 555-0100", at(5000))).toMatchObject({ matched: true, by: "business_line" });
    expect(matchInboundTestCall(c, "+18885550001", at(5000))).toMatchObject({ matched: true, by: "caller" });
  });

  it("never claims a real customer's call, nor one with no test running, nor outside the window", () => {
    const test: ForwardingTest = { id: "t", status: "pending", startedAt: T0.toISOString(), mode: "all_calls", callerNumber: "+18885550001", dialed: "+14155550100" };
    expect(matchInboundTestCall({ setupFlags: { forwardingTest: test } }, "+13105550123", at(5000)).matched).toBe(false);
    expect(matchInboundTestCall({ setupFlags: {} }, "+18885550001", at(5000)).matched).toBe(false);
    expect(matchInboundTestCall({ setupFlags: { forwardingTest: test } }, "+18885550001", at(WAIT_MS.all_calls + LATE_PASS_GRACE_MS + 1)).matched).toBe(false);
    expect(
      matchInboundTestCall({ setupFlags: { forwardingTest: { ...test, status: "passed", finishedAt: at(5000).toISOString() } } }, "+18885550001", at(5000 + PASSED_SWALLOW_MS + 1)).matched,
    ).toBe(false);
  });

  it("a suspended business can't 'pass'", () => {
    const test: ForwardingTest = { id: "t", status: "pending", startedAt: T0.toISOString(), mode: "all_calls", callerNumber: "+18885550001", dialed: "+14155550100" };
    expect(
      matchInboundTestCall({ setupFlags: { forwardingTest: test, suspended: { mode: "off" } } as never }, "+18885550001", at(1000)).matched,
    ).toBe(false);
  });

  it("later webhook events of the same call are swallowed without a second pass", async () => {
    const w = world();
    await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    const markPassed = vi.spyOn(w.deps.store, "markPassed");
    w.state.now = at(7000);
    await claimInboundTestCall(w.deps.store, w.state.client, "+18885550001", w.state.now);
    w.state.now = at(20_000);
    expect(await claimInboundTestCall(w.deps.store, w.state.client, "+18885550001", w.state.now)).toBe(true);
    expect(markPassed).toHaveBeenCalledTimes(1);
  });

  it("a pass that lands just after a recorded miss still wins", async () => {
    const w = world();
    await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    w.state.now = at(WAIT_MS.all_calls + 1000);
    await pollForwardingTest(w.deps, "c1", "t1");
    expect(w.flags().forwardingTest?.status).toBe("failed");
    w.state.now = at(WAIT_MS.all_calls + 5000);
    await claimInboundTestCall(w.deps.store, w.state.client, "+18885550001", w.state.now);
    expect(w.flags().forwardingTest?.status).toBe("passed");
    expect(w.flags().forwardingDone).toBe(true);
  });
});

describe("poll: miss", () => {
  it("is pending while we wait", async () => {
    const w = world();
    await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    w.state.now = at(10_000);
    const v = await pollForwardingTest(w.deps, "c1", "t1");
    expect(v?.status).toBe("pending");
    expect(w.flags().forwardingDone).toBeUndefined();
  });

  it("times out with next steps, and does NOT switch forwarding on", async () => {
    const w = world();
    await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    w.state.now = at(WAIT_MS.all_calls + 1000);
    const v = await pollForwardingTest(w.deps, "c1", "t1");
    expect(v?.status).toBe("failed");
    expect(v?.steps.length).toBeGreaterThan(1);
    expect(w.flags().forwardingDone).toBeUndefined();
    expect(w.flags().forwardingVerifiedAt).toBeUndefined();
  });

  it("fails early, with the right reason, once our own leg has ended and nobody arrived", async () => {
    const w = world();
    await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    w.state.leg = { status: "completed", endedAt: at(12_000) };
    w.state.now = at(12_000 + AFTER_HANGUP_GRACE_MS - 1);
    expect((await pollForwardingTest(w.deps, "c1", "t1"))?.status).toBe("pending");
    w.state.now = at(12_000 + AFTER_HANGUP_GRACE_MS);
    const v = await pollForwardingTest(w.deps, "c1", "t1");
    expect(v).toMatchObject({ status: "failed" });
    expect(v?.headline).toMatch(/answered instead of forwarding/);
  });

  it("explains busy and failed legs", () => {
    expect(describeMiss("busy", "all_calls").headline).toMatch(/busy/);
    expect(describeMiss("dial_failed", "all_calls").headline).toMatch(/couldn't reach/);
  });

  it("in Only-calls-you-miss mode, a picked-up call is explained as the reason it can't pass", () => {
    const d = describeMiss("answered", "missed_only");
    expect(d.detail).toMatch(/only passes when nobody picks up/);
    expect(d.steps.join(" ")).toMatch(/don't pick up/);
  });

  it("returns null for a stale test id", async () => {
    const w = world();
    await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    expect(await pollForwardingTest(w.deps, "c1", "other")).toBeNull();
  });
});

describe("no side effects", () => {
  it("running a whole pass creates no lead, text, usage or call row (nothing in this flow can)", async () => {
    const w = world();
    await startForwardingTest(w.deps, { clientId: "c1", actorId: "u" });
    w.state.now = at(5000);
    await claimInboundTestCall(w.deps.store, w.state.client, "+18885550001", w.state.now);
    expect(w.state.sideEffects).toEqual({ leads: 0, texts: 0, usageMinutes: 0, callRows: 0 });
    // The store interface has no lead / SMS / usage / call-log write at all.
    expect(Object.keys(w.deps.store).sort()).toEqual(
      ["claim", "getClient", "logPlaced", "logResult", "markFailed", "markPassed", "patch", "runsSince", "runsToNumberSince"].sort(),
    );
  });
});
