import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * The whole quote follow-up flow against a real in-process Postgres (PGlite)
 * with the full schema, and a MOCKED Twilio (notifier). Nothing here can send
 * a real text.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const envMock = { SMS_ENABLED: true, APP_URL: "https://app.test" };
vi.mock("@/lib/env", () => ({ env: envMock }));
type SendResult = { ok: boolean; skipped?: boolean; error?: string; id?: string };
const sendSms = vi.fn(async (_m: { to: string; body: string; log?: { clientId: string; kind: string; leadId?: string | null } }): Promise<SendResult> => ({
  ok: true,
  id: "SM1",
}));
vi.mock("@/lib/notifier", () => ({ notifier: { sendSms, sendEmail: vi.fn() } }));

const { db } = await import("@/db");
const s = await import("@/db/schema");
const { sendQuoteFollowups, businessGate } = await import("./quote-followup-send");
const { claimFollowup, getQuoteFollowupStats, loadQuoteCandidates, saveSettings, getSettings } = await import("./quote-followup-data");

const TZ = "America/Los_Angeles";
// 1:00pm PDT on a Thursday.
const NOW = new Date("2026-10-15T20:00:00Z");
const H = 3_600_000;
const ago = (hours: number, from = NOW) => new Date(from.getTime() - hours * H);

let orgId: string;
let n = 0;

async function mkClient(over: Partial<typeof s.clients.$inferInsert> = {}, quote: Record<string, unknown> | false = { enabled: true }) {
  const [c] = await db
    .insert(s.clients)
    .values({
      orgId,
      name: `Ohana ${++n}`,
      timezone: TZ,
      status: "live",
      smsNumber: `+1415556${String(1000 + n)}`,
      ...over,
      setupFlags: { ...(over.setupFlags ?? {}), ...(quote ? { quoteFollowup: quote } : {}) } as never,
    })
    .returning();
  return c;
}

const phone = (i: number) => `+1415555${String(1000 + i)}`;
let callSeq = 0;
async function quoteCall(
  clientId: string,
  i: number,
  over: Partial<typeof s.calls.$inferInsert> = {},
  lead: Partial<typeof s.leads.$inferInsert> | null = { name: "Maria Lopez", reason: "Water heater quote" },
) {
  const [call] = await db
    .insert(s.calls)
    .values({
      clientId,
      fromNumber: phone(i),
      startAt: ago(26),
      endAt: ago(26 - 0.1),
      outcome: "lead",
      summary: "Caller asked how much a water heater costs.",
      retellCallId: `r${++callSeq}`,
      ...over,
    })
    .returning();
  let l = null;
  if (lead) [l] = await db.insert(s.leads).values({ clientId, callId: call.id, phone: phone(i), ...lead }).returning();
  return { call, lead: l };
}
const consent = (clientId: string, i: number) =>
  db.insert(s.smsConsents).values({ clientId, phone: phone(i), wording: "booking-v2" });

beforeEach(async () => {
  sendSms.mockClear();
  sendSms.mockImplementation(async () => ({ ok: true, id: "SM1" }));
  envMock.SMS_ENABLED = true;
  // Each test starts from an empty business table (everything else cascades).
  await db.delete(s.clients);
  await db.delete(s.smsOptOuts);
  if (!orgId) {
    const [org] = await db.insert(s.organizations).values({ name: "Biz", kind: "business" }).returning();
    orgId = org.id;
  }
});

const sentTo = () => sendSms.mock.calls.map((c) => c[0].to);

describe("who gets texted", () => {
  it("is Pro only: a Starter business with the switch on sends nothing", async () => {
    const starter = await mkClient();
    await db.insert(s.subscriptions).values({ clientId: starter.id, plan: "starter", status: "active" });
    await quoteCall(starter.id, 40);
    await consent(starter.id, 40);
    const pro = await mkClient();
    await db.insert(s.subscriptions).values({ clientId: pro.id, plan: "pro", status: "active" });
    await quoteCall(pro.id, 41);
    await consent(pro.id, 41);
    const r = await sendQuoteFollowups(NOW);
    expect(r.notOnPlan).toBe(1);
    expect(sentTo()).toEqual([phone(41)]);
  });

  it("a yes to the AI's quote question (quote-v1) is enough to be texted", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 42);
    await db.insert(s.smsConsents).values({ clientId: c.id, phone: phone(42), wording: "quote-v1" });
    const r = await sendQuoteFollowups(NOW);
    expect(r.sent).toBe(1);
  });

  it("texts a caller who asked for a quote and never booked, a day later, once", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 1);
    await consent(c.id, 1);

    const r1 = await sendQuoteFollowups(NOW);
    expect(r1.sent).toBe(1);
    expect(sendSms).toHaveBeenCalledTimes(1);
    const msg = sendSms.mock.calls[0][0];
    expect(msg.to).toBe("+14155551001");
    expect(msg.body).toContain("Hi Maria");
    expect(msg.body).toContain(c.name);
    expect(msg.body).toContain("Reply STOP to opt out.");
    expect(msg.log).toMatchObject({ clientId: c.id, kind: "quote_followup_1" });

    // Re-running (retry, overlap, the next cron slot) never double-sends.
    const r2 = await sendQuoteFollowups(NOW);
    const r3 = await sendQuoteFollowups(new Date(NOW.getTime() + 2 * H));
    expect(r2.sent + r3.sent).toBe(0);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("two overlapping runs send once", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 2);
    await consent(c.id, 2);
    const [a, b] = await Promise.all([sendQuoteFollowups(NOW), sendQuoteFollowups(NOW)]);
    expect(a.sent + b.sent).toBe(1);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("sends the second text about a week after the call, and only after the first", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 3, { startAt: ago(26), endAt: ago(26) });
    await consent(c.id, 3);
    await sendQuoteFollowups(NOW);
    expect(sendSms).toHaveBeenCalledTimes(1);

    // Six days later: nothing yet.
    sendSms.mockClear();
    const day6 = new Date(NOW.getTime() + 5 * 24 * H);
    await sendQuoteFollowups(day6);
    expect(sendSms).not.toHaveBeenCalled();

    // A week after the call: text 2.
    const day8 = new Date(ago(26).getTime() + 7 * 24 * H + 2 * H);
    await sendQuoteFollowups(day8);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][0].log?.kind).toBe("quote_followup_2");
    expect(sendSms.mock.calls[0][0].body).toContain("again");

    // And never a third.
    sendSms.mockClear();
    await sendQuoteFollowups(new Date(day8.getTime() + 4 * H));
    await sendQuoteFollowups(new Date(day8.getTime() + 30 * 24 * H));
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("doesn't send text 2 if text 1 never went out", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 4, { startAt: ago(24 * 7 + 3), endAt: ago(24 * 7 + 3) });
    await consent(c.id, 4);
    const r = await sendQuoteFollowups(NOW);
    expect(r.sent).toBe(0);
  });

  it("is in the caller's language: Spanish from what they said", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 5, { summary: "Pidió una cotización", transcript: "Agent: Hola\nUser: Hola, quiero una cotización por favor, necesito ayuda con el techo" }, { name: "Ana", reason: null });
    await consent(c.id, 5);
    await sendQuoteFollowups(NOW);
    const body = sendSms.mock.calls[0][0].body;
    expect(body).toContain("Hola Ana");
    expect(body).toContain("Responda STOP");
  });

  it("uses the language saved when they booked before", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 6);
    await consent(c.id, 6);
    await db.insert(s.customerLanguages).values({ clientId: c.id, phone: "14155551006", language: "es" });
    await sendQuoteFollowups(NOW);
    expect(sendSms.mock.calls[0][0].body).toContain("cotización");
  });

  it("uses the owner's own wording when they edited it", async () => {
    const c = await mkClient({}, { enabled: true, step1Template: "{name}, still want that quote from {business}?" });
    await quoteCall(c.id, 7);
    await consent(c.id, 7);
    await sendQuoteFollowups(NOW);
    expect(sendSms.mock.calls[0][0].body).toBe(`Maria, still want that quote from ${c.name}? Reply STOP to opt out.`);
  });

  it("ignores calls that weren't about price, spam, booked or transferred calls, outbound calls and deleted calls", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 10, { summary: "Asked about opening hours." }, { name: "Hours", reason: "Opening hours" });
    await quoteCall(c.id, 11, { outcome: "spam" });
    await quoteCall(c.id, 12, { outcome: "booked" });
    await quoteCall(c.id, 13, { outcome: "escalated" });
    await quoteCall(c.id, 14, { direction: "outbound" });
    await quoteCall(c.id, 15, { deletedAt: ago(1) });
    for (const i of [10, 11, 12, 13, 14, 15]) await consent(c.id, i);
    const r = await sendQuoteFollowups(NOW);
    expect(r.sent).toBe(0);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("is not due yet inside the first day", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 16, { startAt: ago(5), endAt: ago(5) });
    await consent(c.id, 16);
    expect((await sendQuoteFollowups(NOW)).sent).toBe(0);
  });

  it("doesn't text a stale call when the switch is turned on days later", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 17, { startAt: ago(24 * 5), endAt: ago(24 * 5) });
    await consent(c.id, 17);
    expect((await sendQuoteFollowups(NOW)).sent).toBe(0);
  });

  it("never texts another business's callers", async () => {
    const a = await mkClient();
    const b = await mkClient({}, false); // switch off
    await quoteCall(b.id, 18);
    await consent(b.id, 18);
    await consent(a.id, 18); // consent at the wrong business doesn't matter either
    expect((await sendQuoteFollowups(NOW)).sent).toBe(0);
  });
});

describe("it stops", () => {
  async function setup(i: number, opts: { consented?: boolean } = {}) {
    const c = await mkClient();
    const made = await quoteCall(c.id, i);
    if (opts.consented !== false) await consent(c.id, i);
    return { c, ...made };
  }
  const run = async () => (await sendQuoteFollowups(NOW)).stopped;

  it("when they booked since the call (by number, any format)", async () => {
    const { c } = await setup(20);
    await db.insert(s.appointments).values({ clientId: c.id, customerPhone: "(415) 555-1020", startAt: ago(-48), createdAt: ago(10) });
    const stopped = await run();
    expect(stopped.booked).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("when an appointment was made on that very call", async () => {
    const { c, call } = await setup(21);
    await db.insert(s.appointments).values({ clientId: c.id, callId: call.id, customerPhone: "+19998887777", startAt: ago(-48) });
    await run();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("when they already have an upcoming appointment", async () => {
    const { c } = await setup(22);
    await db.insert(s.appointments).values({ clientId: c.id, customerPhone: phone(22), startAt: ago(-72), createdAt: ago(100) });
    expect((await run()).has_upcoming).toBe(1);
  });

  it("a cancelled booking doesn't count as booked", async () => {
    const { c } = await setup(23);
    await db.insert(s.appointments).values({ clientId: c.id, customerPhone: phone(23), startAt: ago(-48), createdAt: ago(10), status: "cancelled" });
    await sendQuoteFollowups(NOW);
    expect(sentTo()).toEqual([phone(23)]);
  });

  it("when they replied by text", async () => {
    const { c } = await setup(24);
    await db.insert(s.smsMessages).values({ clientId: c.id, direction: "inbound", customerPhone: "14155551024", body: "yes please", status: "received", kind: "reply", createdAt: ago(3) });
    expect((await run()).replied).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("when the lead shows a reply", async () => {
    const { c, lead } = await setup(25);
    await db.update(s.leads).set({ lastReplyAt: ago(2) }).where(eq(s.leads.id, lead!.id));
    expect((await run()).replied).toBe(1);
    expect(c.id).toBeTruthy();
  });

  it("when they called back", async () => {
    const { c } = await setup(26);
    await db.insert(s.calls).values({ clientId: c.id, fromNumber: phone(26), startAt: ago(4), outcome: "faq_answered", retellCallId: `r${++callSeq}` });
    expect((await run()).called_back).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("when they texted STOP to this business, or to the shared number", async () => {
    const { c } = await setup(27);
    const { c: c2 } = await setup(28);
    await db.insert(s.clientSmsOptOuts).values({ clientId: c.id, phone: "14155551027", keyword: "STOP" });
    await db.insert(s.smsOptOuts).values({ phone: "14155551028", keyword: "STOP" });
    expect(c2.id).toBeTruthy();
    const stopped = await run();
    expect(stopped.opted_out).toBe(2);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("when the owner blocked the number", async () => {
    const c = await mkClient({ setupFlags: { blockedNumbers: ["4155551029"] } as never });
    await quoteCall(c.id, 29);
    await consent(c.id, 29);
    expect((await run()).blocked).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("when the owner already marked the lead won or lost", async () => {
    const { lead } = await setup(30);
    await db.update(s.leads).set({ status: "lost" }).where(eq(s.leads.id, lead!.id));
    expect((await run()).lead_closed).toBe(1);
  });

  it("when someone already texted them since the call (the owner by hand)", async () => {
    const { c } = await setup(31);
    await db.insert(s.smsMessages).values({ clientId: c.id, direction: "outbound", customerPhone: "14155551031", body: "Hi from the owner", status: "sent", kind: "lead_followup", createdAt: ago(6) });
    expect((await run()).owner_followed_up).toBe(1);
  });

  it("when they never agreed to texts", async () => {
    await setup(32, { consented: false });
    expect((await run()).no_consent).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("when they booked after text 1, so text 2 never goes", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 33, { startAt: ago(26), endAt: ago(26) });
    await consent(c.id, 33);
    await sendQuoteFollowups(NOW);
    expect(sendSms).toHaveBeenCalledTimes(1);
    sendSms.mockClear();
    const day8 = new Date(ago(26).getTime() + 7 * 24 * H + 2 * H);
    await db.insert(s.appointments).values({ clientId: c.id, customerPhone: phone(33), startAt: new Date(day8.getTime() + 48 * H), createdAt: new Date(NOW.getTime() + 24 * H) });
    await sendQuoteFollowups(day8);
    expect(sendSms).not.toHaveBeenCalled();
  });
});

describe("business-level gates", () => {
  async function ready(over: Partial<typeof s.clients.$inferInsert> = {}) {
    const c = await mkClient(over);
    await quoteCall(c.id, 40);
    await consent(c.id, 40);
    return c;
  }

  it("does nothing while the switch is off (the default)", async () => {
    const c = await mkClient({}, false);
    await quoteCall(c.id, 41);
    await consent(c.id, 41);
    const r = await sendQuoteFollowups(NOW);
    expect(r.clients).toBe(0);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does nothing when business texting isn't approved (SMS_ENABLED off)", async () => {
    await ready();
    envMock.SMS_ENABLED = false;
    const r = await sendQuoteFollowups(NOW);
    expect(r.gated).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does nothing without the business's own texting number", async () => {
    await ready({ smsNumber: null });
    const r = await sendQuoteFollowups(NOW);
    expect(r.gated).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does nothing for a suspended, deleted, lapsed or unpaid company", async () => {
    await ready({ setupFlags: { suspended: { at: "x", by: "op", mode: "off", previousStatus: "live", stripe: { action: "none", prorate: false } } } as never });
    await ready({ deletedAt: new Date() });
    await ready({ setupFlags: { trialLapsedAt: "2026-10-01T00:00:00Z" } as never });
    await ready({ setupFlags: { stripeUnpaidAt: "2026-10-01T00:00:00Z" } as never });
    await ready({ status: "paused" });
    await sendQuoteFollowups(NOW);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("businessGate names the reason", () => {
    const base = { setupFlags: {}, status: "live", smsNumber: "+14155550999", deletedAt: null } as never;
    expect(businessGate(base)).toBeNull();
    expect(businessGate({ ...(base as object), smsNumber: null } as never)).toBe("no_texting_number");
    expect(businessGate({ ...(base as object), deletedAt: new Date() } as never)).toBe("deleted");
  });

  it("waits outside 9am-7pm in the business's own zone", async () => {
    await ready();
    // 2am PDT.
    expect((await sendQuoteFollowups(new Date("2026-10-15T09:00:00Z"))).notDue).toBe(1);
    // 7:30pm PDT.
    expect((await sendQuoteFollowups(new Date("2026-10-16T02:30:00Z"))).notDue).toBe(1);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("uses each business's own time zone", async () => {
    // 1pm Pacific is 4pm Eastern: fine for both. 8am Pacific is 11am Eastern: only Eastern sends.
    const east = await mkClient({ timezone: "America/New_York" });
    await quoteCall(east.id, 42, { startAt: new Date("2026-10-14T12:00:00Z"), endAt: new Date("2026-10-14T12:00:00Z") });
    await consent(east.id, 42);
    const west = await mkClient({ timezone: TZ });
    await quoteCall(west.id, 43, { startAt: new Date("2026-10-14T12:00:00Z"), endAt: new Date("2026-10-14T12:00:00Z") });
    await consent(west.id, 43);
    await sendQuoteFollowups(new Date("2026-10-15T15:00:00Z")); // 8am PDT / 11am EDT
    expect(sentTo()).toEqual([phone(42)]);
  });

  it("respects the owner's texting-off switch and quiet hours", async () => {
    const c = await ready();
    await db.insert(s.clientTextingPrefs).values({ clientId: c.id, textingEnabled: false });
    await sendQuoteFollowups(NOW);
    expect(sendSms).not.toHaveBeenCalled();
    // Quiet hours that cover 1pm.
    await db.update(s.clientTextingPrefs).set({ textingEnabled: true, quietStartHour: 12, quietEndHour: 14 }).where(eq(s.clientTextingPrefs.clientId, c.id));
    await sendQuoteFollowups(NOW);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("caps a run so a backlog can't blast everyone at once", async () => {
    const c = await mkClient();
    for (let i = 0; i < 20; i++) {
      await quoteCall(c.id, 100 + i);
      await consent(c.id, 100 + i);
    }
    const r = await sendQuoteFollowups(NOW);
    expect(r.sent).toBe(15);
    // The rest go on later runs, up to the daily cap.
    const r2 = await sendQuoteFollowups(new Date(NOW.getTime() + 2 * H));
    expect(r2.sent).toBe(5);
  });
});

describe("failures", () => {
  it("releases the claim when nothing was sent (provider off), so a later run retries", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 50);
    await consent(c.id, 50);
    sendSms.mockImplementationOnce(async () => ({ ok: false, skipped: true }));
    const r1 = await sendQuoteFollowups(NOW);
    expect(r1.sent).toBe(0);
    const r2 = await sendQuoteFollowups(NOW);
    expect(r2.sent).toBe(1);
  });

  it("retries a failed send once, then leaves the number alone", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 51);
    await consent(c.id, 51);
    sendSms.mockImplementation(async () => ({ ok: false, error: "Twilio 21614" }));
    expect((await sendQuoteFollowups(NOW)).failed).toBe(1);
    expect((await sendQuoteFollowups(NOW)).failed).toBe(1);
    sendSms.mockClear();
    await sendQuoteFollowups(NOW);
    await sendQuoteFollowups(NOW);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("a throw from the provider counts as failed, not sent", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 52);
    await consent(c.id, 52);
    sendSms.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const r = await sendQuoteFollowups(NOW);
    expect(r.failed).toBe(1);
    expect(r.sent).toBe(0);
  });
});

describe("claimFollowup", () => {
  it("hands out each person-and-step once", async () => {
    const c = await mkClient();
    const base = { clientId: c.id, key: "4155559999", phone: "+14155559999", callId: "x", leadId: null, now: NOW };
    expect(await claimFollowup({ ...base, step: 1 })).toBeTruthy();
    expect(await claimFollowup({ ...base, step: 1 })).toBeNull();
    expect(await claimFollowup({ ...base, step: 2 })).toBeTruthy();
  });
});

describe("settings", () => {
  it("saves without clobbering other flags, and reads back", async () => {
    const c = await mkClient({ setupFlags: { dailyBriefing: true, comped: true } as never }, false);
    expect((await getSettings(c.id)).enabled).toBe(false);
    await saveSettings(c.id, { enabled: true, enabledAt: "2026-10-15T00:00:00Z", step1Template: "Hi {name}" });
    const [row] = await db.select().from(s.clients).where(eq(s.clients.id, c.id));
    expect(row.setupFlags).toMatchObject({ dailyBriefing: true, comped: true, quoteFollowup: { enabled: true, step1Template: "Hi {name}" } });
    await saveSettings(c.id, { enabled: false });
    const after = await getSettings(c.id);
    expect(after).toMatchObject({ enabled: false, step1Template: undefined });
  });
});

describe("results", () => {
  it("counts replies and bookings that came after the text, and only those", async () => {
    const c = await mkClient();
    // Maria: texted, then replied and booked (priced service).
    await quoteCall(c.id, 60);
    await consent(c.id, 60);
    // Bo: texted, never answered.
    await quoteCall(c.id, 61, {}, { name: "Bo", reason: "estimate" });
    await consent(c.id, 61);
    // Cy: booked BEFORE the text would have gone: not texted, not counted.
    await quoteCall(c.id, 62, {}, { name: "Cy", reason: "quote" });
    await consent(c.id, 62);
    await db.insert(s.appointments).values({ clientId: c.id, customerPhone: phone(62), startAt: ago(-24), createdAt: ago(10) });

    await sendQuoteFollowups(NOW);
    expect(sentTo().sort()).toEqual([phone(60), phone(61)]);

    const [svc] = await db.insert(s.services).values({ clientId: c.id, name: "Water heater visit", priceCents: 18000 }).returning();
    const later = new Date(NOW.getTime() + 5 * H);
    await db.insert(s.smsMessages).values({ clientId: c.id, direction: "inbound", customerPhone: "14155551060", body: "yes", status: "received", kind: "reply", createdAt: later });
    await db.insert(s.appointments).values({ clientId: c.id, customerPhone: phone(60), serviceId: svc.id, startAt: new Date(later.getTime() + 48 * H), createdAt: new Date(later.getTime() + H) });

    const stats = await getQuoteFollowupStats(c.id, new Date(NOW.getTime() + 10 * H));
    expect(stats).toMatchObject({
      textsSent: 2,
      peopleTexted: 2,
      replies: 1,
      bookingsAfter: 1,
      bookedValueCents: 18000,
      bookingsWithoutPrice: 0,
    });
  });

  it("shows no dollar value when no real price exists, and doesn't treat 'starts at' as a value", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 63);
    await consent(c.id, 63);
    await quoteCall(c.id, 64, {}, { name: "Di", reason: "price" });
    await consent(c.id, 64);
    await sendQuoteFollowups(NOW);
    const [from] = await db.insert(s.services).values({ clientId: c.id, name: "Starts at", priceCents: 9900, priceFrom: true }).returning();
    const later = new Date(NOW.getTime() + 5 * H);
    await db.insert(s.appointments).values({ clientId: c.id, customerPhone: phone(63), startAt: new Date(later.getTime() + 48 * H), createdAt: later });
    await db.insert(s.appointments).values({ clientId: c.id, customerPhone: phone(64), serviceId: from.id, startAt: new Date(later.getTime() + 48 * H), createdAt: later });
    const stats = await getQuoteFollowupStats(c.id, new Date(NOW.getTime() + 10 * H));
    expect(stats?.bookingsAfter).toBe(2);
    expect(stats?.bookedValueCents).toBeNull();
    expect(stats?.bookingsWithoutPrice).toBe(2);
  });

  it("with nothing sent, says how many asked and how many agreed to texts", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 65);
    await quoteCall(c.id, 66, {}, { name: "Ed", reason: "quote" });
    await consent(c.id, 65);
    const stats = await getQuoteFollowupStats(c.id, NOW);
    expect(stats).toMatchObject({ textsSent: 0, askedRecently: 2, askedAndAgreedToTexts: 1 });
  });

  it("counts for this business only", async () => {
    const a = await mkClient();
    const b = await mkClient();
    await quoteCall(a.id, 67);
    await consent(a.id, 67);
    await sendQuoteFollowups(NOW);
    expect((await getQuoteFollowupStats(b.id, NOW))?.textsSent).toBe(0);
    expect((await getQuoteFollowupStats(a.id, NOW))?.textsSent).toBe(1);
  });
});

describe("candidates", () => {
  it("anchors on the latest quote call per number", async () => {
    const c = await mkClient();
    await quoteCall(c.id, 70, { startAt: ago(100), endAt: ago(100) });
    await quoteCall(c.id, 70, { startAt: ago(30), endAt: ago(30) });
    const cands = await loadQuoteCandidates(c, NOW);
    expect(cands).toHaveLength(1);
    expect(Math.round((NOW.getTime() - cands![0].callStartAt.getTime()) / H)).toBe(30);
  });
});
