import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SMS inbox data layer against a real (in-process) Postgres — PGlite — with
 * the actual manual migration applied, so these tests exercise the real SQL:
 * the unique MessageSid index (idempotency), DISTINCT ON for the conversation
 * list, and above all that every read is scoped to one business.
 */

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  const pg = new PGlite();
  return { db: drizzle(pg, { schema }), __pg: pg };
});
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const dbModule = (await import("@/db")) as unknown as {
  __pg: import("@electric-sql/pglite").PGlite;
};
const pg = dbModule.__pg;
const inbox = await import("./sms-messages");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../../drizzle/manual/0007_sms_messages.sql"),
  "utf8",
);

beforeAll(async () => {
  // Minimal stand-ins for the tables the migration's foreign keys point at.
  await pg.exec(`
    CREATE TABLE clients (id uuid PRIMARY KEY);
    CREATE TABLE appointments (id uuid PRIMARY KEY);
    CREATE TABLE leads (id uuid PRIMARY KEY);
    INSERT INTO clients (id) VALUES ('${A}'), ('${B}');
  `);
  await pg.exec(MIGRATION);
});

beforeEach(async () => {
  await pg.exec(`DELETE FROM sms_messages;`);
});

const at = (iso: string) => new Date(iso);
async function setCreated(sid: string, iso: string) {
  await pg.query(`UPDATE sms_messages SET created_at = $1 WHERE provider_sid = $2`, [iso, sid]);
}

describe("migration 0007_sms_messages", () => {
  it("is idempotent — running it again is a no-op", async () => {
    await expect(pg.exec(MIGRATION)).resolves.toBeDefined();
  });
});

describe("recordInboundSms", () => {
  it("stores the reply under the business with a normalized customer phone", async () => {
    const r = await inbox.recordInboundSms({
      clientId: A,
      from: "+1 (415) 555-0100",
      to: "+16505550000",
      body: "Can we do 3pm instead?",
      providerSid: "SM_in_1",
      kind: "reply",
    });
    expect(r).toEqual({ stored: true, isNew: true });
    const thread = await inbox.getThread(A, "4155550100");
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({
      clientId: A,
      direction: "inbound",
      customerPhone: "14155550100",
      businessPhone: "16505550000",
      body: "Can we do 3pm instead?",
      status: "received",
      kind: "reply",
      providerSid: "SM_in_1",
      readAt: null,
    });
  });

  it("is idempotent on MessageSid — a Twilio replay is stored once and reported as not new", async () => {
    const input = {
      clientId: A,
      from: "+14155550100",
      to: null,
      body: "YES",
      providerSid: "SM_dupe",
      kind: "opt_in" as const,
    };
    expect((await inbox.recordInboundSms(input)).isNew).toBe(true);
    expect((await inbox.recordInboundSms(input)).isNew).toBe(false);
    expect(await inbox.getThread(A, "+14155550100")).toHaveLength(1);
  });

  it("stores STOP/HELP keywords too, with their kind", async () => {
    await inbox.recordInboundSms({ clientId: A, from: "+14155550100", to: null, body: "STOP", providerSid: "SM_s", kind: "opt_out" });
    await inbox.recordInboundSms({ clientId: A, from: "+14155550100", to: null, body: "HELP", providerSid: "SM_h", kind: "help" });
    const kinds = (await inbox.getThread(A, "+14155550100")).map((m) => m.kind).sort();
    expect(kinds).toEqual(["help", "opt_out"]);
  });

  it("refuses an unusable phone rather than storing junk", async () => {
    const r = await inbox.recordInboundSms({ clientId: A, from: "abc", to: null, body: "x", providerSid: "SM_x", kind: "reply" });
    expect(r.stored).toBe(false);
  });
});

describe("recordOutboundSms / delivery status", () => {
  it("stores sent and failed texts; failed sends without a sid don't collide", async () => {
    const ctx = { clientId: A, kind: "appointment_reminder" };
    await inbox.recordOutboundSms(ctx, { to: "+14155550100", from: "+16505550000", body: "Reminder", ok: true, providerSid: "SM_out_1" });
    await inbox.recordOutboundSms(ctx, { to: "+14155550100", from: null, body: "try 1", ok: false, error: "boom" });
    await inbox.recordOutboundSms(ctx, { to: "+14155550100", from: null, body: "try 2", ok: false });
    const thread = await inbox.getThread(A, "+14155550100");
    expect(thread.map((m) => m.status).sort()).toEqual(["failed", "failed", "sent"]);
    expect(thread.find((m) => m.body === "try 1")?.error).toBe("boom");
  });

  it("applies the carrier's verdict by sid", async () => {
    await inbox.recordOutboundSms({ clientId: A, kind: "recall" }, { to: "+14155550100", from: null, body: "a", ok: true, providerSid: "SM_d" });
    await inbox.recordOutboundSms({ clientId: A, kind: "recall" }, { to: "+14155550101", from: null, body: "b", ok: true, providerSid: "SM_f" });
    await inbox.updateSmsDeliveryStatus("SM_d", "delivered");
    await inbox.updateSmsDeliveryStatus("SM_f", "failed", "Carrier said no");
    expect((await inbox.getThread(A, "+14155550100"))[0].status).toBe("delivered");
    expect((await inbox.getThread(A, "+14155550101"))[0]).toMatchObject({ status: "failed", error: "Carrier said no" });
  });
});

describe("findClientLastMessaged (tenant resolution for the shared number)", () => {
  it("returns the business that most recently texted this customer", async () => {
    await inbox.recordOutboundSms({ clientId: A, kind: "recall" }, { to: "+14155550100", from: null, body: "from A", ok: true, providerSid: "SM_a" });
    await inbox.recordOutboundSms({ clientId: B, kind: "recall" }, { to: "+14155550100", from: null, body: "from B", ok: true, providerSid: "SM_b" });
    await setCreated("SM_a", "2026-09-01T10:00:00Z");
    await setCreated("SM_b", "2026-09-02T10:00:00Z");
    expect(await inbox.findClientLastMessaged("(415) 555-0100")).toBe(B);
    await setCreated("SM_a", "2026-09-03T10:00:00Z");
    expect(await inbox.findClientLastMessaged("+14155550100")).toBe(A);
  });

  it("ignores inbound rows and unknown numbers", async () => {
    await inbox.recordInboundSms({ clientId: A, from: "+14155550199", to: null, body: "hi", providerSid: "SM_i", kind: "reply" });
    expect(await inbox.findClientLastMessaged("+14155550199")).toBeNull();
    expect(await inbox.findClientLastMessaged("+19998887777")).toBeNull();
  });
});

describe("conversation list", () => {
  it("groups by customer, latest conversation first, with the latest message and unread count", async () => {
    await inbox.recordOutboundSms({ clientId: A, kind: "appointment_confirmation" }, { to: "+14155550100", from: null, body: "You're booked", ok: true, providerSid: "SM1" });
    await inbox.recordInboundSms({ clientId: A, from: "+14155550100", to: null, body: "Thanks!", providerSid: "SM2", kind: "reply" });
    await inbox.recordInboundSms({ clientId: A, from: "+14155550100", to: null, body: "Actually, 3pm?", providerSid: "SM3", kind: "reply" });
    await inbox.recordOutboundSms({ clientId: A, kind: "recall" }, { to: "+14155550111", from: null, body: "Time to rebook", ok: true, providerSid: "SM4" });
    await setCreated("SM1", "2026-09-01T10:00:00Z");
    await setCreated("SM2", "2026-09-01T10:05:00Z");
    await setCreated("SM3", "2026-09-01T10:06:00Z");
    await setCreated("SM4", "2026-09-02T09:00:00Z");

    const list = await inbox.listConversations(A);
    expect(list.map((c) => c.customerPhone)).toEqual(["14155550111", "14155550100"]);
    expect(list[0]).toMatchObject({ lastBody: "Time to rebook", lastDirection: "outbound", unread: 0, total: 1 });
    expect(list[1]).toMatchObject({ lastBody: "Actually, 3pm?", lastDirection: "inbound", unread: 2, total: 3 });
    expect(list[1].lastAt.toISOString()).toBe(at("2026-09-01T10:06:00Z").toISOString());
  });

  it("thread is oldest → newest and markThreadRead clears unread", async () => {
    await inbox.recordOutboundSms({ clientId: A, kind: "appointment_reminder" }, { to: "+14155550100", from: null, body: "first", ok: true, providerSid: "T1" });
    await inbox.recordInboundSms({ clientId: A, from: "+14155550100", to: null, body: "second", providerSid: "T2", kind: "reply" });
    await setCreated("T1", "2026-09-01T10:00:00Z");
    await setCreated("T2", "2026-09-01T11:00:00Z");
    expect((await inbox.getThread(A, "14155550100")).map((m) => m.body)).toEqual(["first", "second"]);
    expect(await inbox.countUnreadMessages(A)).toBe(1);
    expect(await inbox.markThreadRead(A, "14155550100")).toBe(1);
    expect(await inbox.countUnreadMessages(A)).toBe(0);
    expect((await inbox.listConversations(A))[0].unread).toBe(0);
  });
});

describe("tenant isolation", () => {
  // The same customer is a customer of BOTH businesses — the realistic case
  // (they see a dentist and a plumber) and the one that must never cross over.
  const SHARED = "+14155550100";

  beforeEach(async () => {
    await inbox.recordOutboundSms({ clientId: A, kind: "appointment_reminder" }, { to: SHARED, from: null, body: "A: see you tomorrow", ok: true, providerSid: "IA1" });
    await inbox.recordInboundSms({ clientId: A, from: SHARED, to: null, body: "reply to A", providerSid: "IA2", kind: "reply" });
    await inbox.recordOutboundSms({ clientId: B, kind: "recall" }, { to: SHARED, from: null, body: "B: time for a tune-up", ok: true, providerSid: "IB1" });
    await inbox.recordInboundSms({ clientId: B, from: SHARED, to: null, body: "reply to B", providerSid: "IB2", kind: "reply" });
    await inbox.recordInboundSms({ clientId: B, from: "+14155550222", to: null, body: "B-only customer", providerSid: "IB3", kind: "reply" });
  });

  it("an owner's conversation list contains only their business's messages", async () => {
    const a = await inbox.listConversations(A);
    expect(a.map((c) => c.customerPhone)).toEqual(["14155550100"]);
    expect(a[0].total).toBe(2);
    expect(a[0].lastBody).not.toMatch(/B/);
    const b = await inbox.listConversations(B);
    expect(b.map((c) => c.customerPhone).sort()).toEqual(["14155550100", "14155550222"]);
  });

  it("a thread only shows that business's side, even for a shared customer", async () => {
    const a = await inbox.getThread(A, SHARED);
    expect(a.map((m) => m.body)).toEqual(expect.arrayContaining(["A: see you tomorrow", "reply to A"]));
    expect(a.every((m) => m.clientId === A)).toBe(true);
    expect(a.some((m) => m.body.includes("B"))).toBe(false);
  });

  it("guessing another business's customer number returns nothing", async () => {
    expect(await inbox.getThread(A, "+14155550222")).toEqual([]);
  });

  it("marking read in one business never touches the other's unread state", async () => {
    expect(await inbox.countUnreadMessages(A)).toBe(1);
    expect(await inbox.countUnreadMessages(B)).toBe(2);
    await inbox.markThreadRead(A, SHARED);
    // Also try to mark B's B-only customer as read from A's session.
    expect(await inbox.markThreadRead(A, "+14155550222")).toBe(0);
    expect(await inbox.countUnreadMessages(A)).toBe(0);
    expect(await inbox.countUnreadMessages(B)).toBe(2);
  });
});
