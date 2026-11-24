import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Text back vs AI call back against a real in-process Postgres (PGlite) with
 * the full schema: the attribution window, what counts as a response, booking
 * exclusions, the lookback, and tenant scoping.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
const warn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));

const { db } = await import("@/db");
const s = await import("@/db/schema");
const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const { getFollowUpComparison } = await import("./followup-channels");

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
let clientId: string;
let otherId: string;
let seq = 0;

/** One sent follow-up to a fresh caller; returns that caller's digits. */
async function followUp(
  channel: "sms" | "ai_call",
  opts: { daysAgo?: number; status?: string; client?: string; retell?: string } = {},
) {
  seq += 1;
  const phone = `1415555${String(1000 + seq).slice(-4)}`;
  const cid = opts.client ?? clientId;
  const [missed] = await db
    .insert(s.calls)
    .values({ clientId: cid, direction: "inbound", fromNumber: `+${phone}`, startAt: ago((opts.daysAgo ?? 3) + 0.01) })
    .returning();
  await db.insert(s.callCallbacks).values({
    clientId: cid,
    callId: missed.id,
    customerPhone: phone,
    reason: "hung_up_early",
    status: opts.status ?? "sent",
    channel,
    sentAt: ago(opts.daysAgo ?? 3),
    retellCallId: opts.retell ?? null,
  });
  return phone;
}

async function textBack(phone: string, daysAfterSend: number, sentDaysAgo = 3, kind = "reply") {
  await db.insert(s.smsMessages).values({
    clientId,
    direction: "inbound",
    customerPhone: phone,
    body: "yes please",
    status: "received",
    kind,
    createdAt: ago(sentDaysAgo - daysAfterSend),
  });
}

async function book(phone: string, daysAfterSend: number, sentDaysAgo = 3, status: "booked" | "cancelled" | "no_show" = "booked", client = clientId) {
  await db.insert(s.appointments).values({
    clientId: client,
    customerPhone: `(${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7)}`,
    startAt: new Date(Date.now() + 2 * DAY),
    status,
    createdAt: ago(sentDaysAgo - daysAfterSend),
  });
}

async function aiCall(retell: string, phone: string, durationSec: number, reason: string) {
  await db.insert(s.calls).values({
    clientId,
    retellCallId: retell,
    direction: "outbound",
    toNumber: `+${phone}`,
    startAt: ago(2.99),
    durationSec,
    rawPayload: { event: "call_analyzed", call: { disconnection_reason: reason } },
  });
}

beforeEach(async () => {
  await pg.exec(
    `DELETE FROM sms_messages; DELETE FROM appointments; DELETE FROM call_callbacks; DELETE FROM calls; DELETE FROM clients; DELETE FROM organizations;`,
  );
  const [org] = await db.insert(s.organizations).values({ name: "Biz", kind: "business" }).returning();
  const [c, o] = await db
    .insert(s.clients)
    .values([
      { orgId: org.id, name: "Bright" },
      { orgId: org.id, name: "Other" },
    ])
    .returning();
  clientId = c.id;
  otherId = o.id;
  warn.mockClear();
});

describe("getFollowUpComparison", () => {
  it("is null when no follow-up was sent", async () => {
    await followUp("sms", { status: "skipped" });
    await followUp("sms", { status: "pending" });
    expect(await getFollowUpComparison(clientId)).toBeNull();
  });

  it("counts text replies and call-ins within 7 days, and bookings made within 7 days", async () => {
    const replied = await followUp("sms");
    await textBack(replied, 1);
    const repliedLate = await followUp("sms", { daysAgo: 10 });
    await textBack(repliedLate, 8, 10); // outside the window
    const stop = await followUp("sms");
    await textBack(stop, 1, 3, "opt_out"); // STOP is not a response
    const calledIn = await followUp("sms");
    await db.insert(s.calls).values({ clientId, direction: "inbound", fromNumber: `+${calledIn}`, startAt: ago(2) });
    const booked = await followUp("sms");
    await book(booked, 0.5);
    const bookedLate = await followUp("sms", { daysAgo: 12 });
    await book(bookedLate, 9, 12);
    const cancelled = await followUp("sms");
    await book(cancelled, 1, 3, "cancelled");
    const bookedBefore = await followUp("sms");
    await book(bookedBefore, -1); // made before the text went out

    const r = (await getFollowUpComparison(clientId))!;
    expect(r.text).toMatchObject({ sent: 8, responded: 2, booked: 1, enough: true, respondedPct: 25, bookedPct: 13 });
    expect(r.call.sent).toBe(0);
    expect(r.comparable).toBe(false);
  });

  it("counts an AI callback as a response only when a person picked up", async () => {
    const talked = await followUp("ai_call", { retell: "r_talk" });
    await aiCall("r_talk", talked, 45, "agent_hangup");
    const vm = await followUp("ai_call", { retell: "r_vm" });
    await aiCall("r_vm", vm, 30, "voicemail_reached");
    const noAnswer = await followUp("ai_call", { retell: "r_na" });
    await aiCall("r_na", noAnswer, 0, "dial_no_answer");
    const short = await followUp("ai_call", { retell: "r_short" });
    await aiCall("r_short", short, 4, "user_hangup");
    const rangBack = await followUp("ai_call", { retell: "r_none" }); // call row never arrived
    await textBack(rangBack, 2);
    await book(talked, 0.1);

    const r = (await getFollowUpComparison(clientId))!;
    expect(r.call).toMatchObject({ sent: 5, responded: 2, booked: 1, respondedPct: 40, bookedPct: 20 });
  });

  it("only looks at the last 30 days and only this business", async () => {
    await followUp("sms", { daysAgo: 31 });
    const theirs = await followUp("sms", { client: otherId });
    await book(theirs, 1, 3, "booked", otherId);
    // A booking under another business for one of OUR callers doesn't count.
    const ours = await followUp("sms");
    await book(ours, 1, 3, "booked", otherId);

    const r = (await getFollowUpComparison(clientId))!;
    expect(r.text).toMatchObject({ sent: 1, booked: 0, enough: false, bookedPct: null });
    expect((await getFollowUpComparison(otherId))!.text).toMatchObject({ sent: 1, booked: 1 });
  });

  it("fails soft to null when the table is missing", async () => {
    await pg.exec(`ALTER TABLE call_callbacks RENAME TO call_callbacks_gone`);
    try {
      expect(await getFollowUpComparison(clientId)).toBeNull();
      expect(warn).toHaveBeenCalledWith("followup_channels.read_failed", expect.anything());
    } finally {
      await pg.exec(`ALTER TABLE call_callbacks_gone RENAME TO call_callbacks`);
    }
  });
});
