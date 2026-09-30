import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guards on "reply by text" from portal → Messages, against a real in-process
 * Postgres (PGlite) with the actual sms_messages migration, and the real
 * notifier with Twilio stubbed — so a successful send is recorded by the same
 * code path production uses.
 */

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  const pg = new PGlite();
  return { db: drizzle(pg, { schema }), __pg: pg };
});
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER = "14155550100";

let session = { clientId: A, preview: false };
vi.mock("@/lib/auth-guard", () => ({ resolvePortalClient: async () => session }));
vi.mock("@/lib/data/clients", () => ({
  getClientByIdUnsafe: async (id: string) => ({ id, name: id === A ? "Acme Dental" : "Other Biz" }),
}));

const isOptedOut = vi.fn(async (_phone: string) => false);
vi.mock("@/lib/data/sms-optouts", async (orig) => ({
  ...(await orig<typeof import("@/lib/data/sms-optouts")>()),
  isOptedOut: (p: string) => isOptedOut(p),
}));
const hasSmsConsent = vi.fn(async (..._args: unknown[]) => false);
vi.mock("@/lib/data/sms-consents", () => ({ hasSmsConsent: (...a: unknown[]) => hasSmsConsent(...a) }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

const create = vi.fn();
vi.mock("twilio", () => ({ default: () => ({ messages: { create } }) }));
vi.mock("resend", () => ({ Resend: class {} }));
let twilioOn = true;
vi.mock("@/lib/env", () => ({
  env: { TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+18885550000" },
  integrations: { twilio: () => twilioOn, resend: () => false },
  webhookUrl: (p: string) => `https://app.test${p}`,
}));

const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const { sendMessageReplyAction } = await import("./messages");
const { PORTAL_REPLIES_PER_THREAD_PER_DAY, MAX_REPLY_CHARS } = await import("@/lib/sms-reply");

const MIGRATION = readFileSync(path.resolve(__dirname, "../../../drizzle/manual/0007_sms_messages.sql"), "utf8");

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE clients (id uuid PRIMARY KEY);
    CREATE TABLE appointments (id uuid PRIMARY KEY);
    CREATE TABLE leads (id uuid PRIMARY KEY);
    INSERT INTO clients (id) VALUES ('${A}'), ('${B}');
  `);
  await pg.exec(MIGRATION);
});

async function seed(clientId: string, direction: "inbound" | "outbound", phone = CUSTOMER, kind = "reply") {
  await pg.query(
    `INSERT INTO sms_messages (client_id, direction, customer_phone, body, status, kind)
     VALUES ($1, $2, $3, 'seed', $4, $5)`,
    [clientId, direction, phone, direction === "inbound" ? "received" : "sent", kind],
  );
}

async function rows(clientId: string) {
  const r = await pg.query<Record<string, unknown>>(
    `SELECT * FROM sms_messages WHERE client_id = $1 AND kind = 'portal_reply' ORDER BY created_at`,
    [clientId],
  );
  return r.rows;
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const send = (fields: Record<string, string>) => sendMessageReplyAction({}, form(fields));

beforeEach(async () => {
  await pg.exec(`DELETE FROM sms_messages;`);
  session = { clientId: A, preview: false };
  twilioOn = true;
  isOptedOut.mockReset().mockResolvedValue(false);
  hasSmsConsent.mockReset().mockResolvedValue(false);
  revalidatePath.mockReset();
  create.mockReset().mockResolvedValue({ sid: "SM_reply_1" });
});

describe("sendMessageReplyAction — success", () => {
  it("sends via Twilio, records an outbound 'sent' row for the session's business, marks read, revalidates", async () => {
    await seed(A, "inbound");
    const r = await send({ phone: CUSTOMER, body: "  See you at 3!  " });
    expect(r).toEqual({ ok: true, message: "Reply sent." });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      to: "+14155550100",
      from: "+18885550000",
      body: "Acme Dental: See you at 3!",
    });

    const out = await rows(A);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      direction: "outbound",
      customer_phone: CUSTOMER,
      business_phone: "18885550000",
      status: "sent",
      provider_sid: "SM_reply_1",
      body: "Acme Dental: See you at 3!",
      error: null,
    });

    const unread = await pg.query(
      `SELECT count(*)::int AS n FROM sms_messages WHERE direction = 'inbound' AND read_at IS NULL`,
    );
    expect((unread.rows[0] as { n: number }).n).toBe(0);
    expect(revalidatePath).toHaveBeenCalledWith(`/portal/messages/${CUSTOMER}`);
    // Conversational reply: no consent lookup, no opt-out footer.
    expect(hasSmsConsent).not.toHaveBeenCalled();
  });

  it("records a failed send as 'failed' with the error and returns a friendly message", async () => {
    await seed(A, "inbound");
    create.mockRejectedValue(Object.assign(new Error("Invalid To"), { code: 21211 }));
    const r = await send({ phone: CUSTOMER, body: "Hello" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/mobile number/);
    const out = await rows(A);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ status: "failed", provider_sid: null, error: "Invalid To (Twilio 21211)" });
  });

  it("when texting isn't configured (demo), sends and records nothing", async () => {
    await seed(A, "inbound");
    twilioOn = false;
    const r = await send({ phone: CUSTOMER, body: "Hello" });
    expect(r).toEqual({ ok: false, error: "Texting isn't connected yet, so nothing was sent." });
    expect(create).not.toHaveBeenCalled();
    expect(await rows(A)).toHaveLength(0);
  });
});

describe("sendMessageReplyAction — guards", () => {
  it("blocks an opted-out customer", async () => {
    await seed(A, "inbound");
    isOptedOut.mockResolvedValue(true);
    const r = await send({ phone: CUSTOMER, body: "Hello" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/STOP/);
    expect(create).not.toHaveBeenCalled();
    expect(await rows(A)).toHaveLength(0);
  });

  it("blocks a number this business has no conversation with (even if another business does)", async () => {
    await seed(B, "inbound");
    const r = await send({ phone: CUSTOMER, body: "Hello" });
    expect(r).toEqual({ ok: false, error: "Conversation not found." });
    expect(create).not.toHaveBeenCalled();
  });

  it("uses the session's business, never one from the form", async () => {
    await seed(B, "inbound");
    const r = await send({ phone: CUSTOMER, body: "Hello", clientId: B });
    expect(r).toEqual({ ok: false, error: "Conversation not found." });
    expect(create).not.toHaveBeenCalled();
    expect(await rows(B)).toHaveLength(0);
  });

  it("rejects a malformed phone without querying", async () => {
    const r = await send({ phone: "+1 415 555 0100'--", body: "Hello" });
    expect(r).toEqual({ ok: false, error: "Conversation not found." });
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks an operator previewing the portal", async () => {
    await seed(A, "inbound");
    session = { clientId: A, preview: true };
    const r = await send({ phone: CUSTOMER, body: "Hello" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/previewing/);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects empty / whitespace-only input", async () => {
    await seed(A, "inbound");
    expect((await send({ phone: CUSTOMER, body: "   " })).error).toBe("Type a message first.");
    expect((await send({ phone: CUSTOMER })).error).toBe("Type a message first.");
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects input over the max length", async () => {
    await seed(A, "inbound");
    const r = await send({ phone: CUSTOMER, body: "x".repeat(MAX_REPLY_CHARS + 1) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(String(MAX_REPLY_CHARS));
    expect(create).not.toHaveBeenCalled();
  });

  it("customer never texted in: requires stored consent", async () => {
    await seed(A, "outbound", CUSTOMER, "appointment_confirmation");
    const r = await send({ phone: CUSTOMER, body: "Hello" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/agreed to texts/);
    expect(hasSmsConsent).toHaveBeenCalledWith(A, CUSTOMER, "portal_reply");
    expect(create).not.toHaveBeenCalled();
  });

  it("customer never texted in but consented: sends with the opt-out line", async () => {
    await seed(A, "outbound", CUSTOMER, "appointment_confirmation");
    hasSmsConsent.mockResolvedValue(true);
    const r = await send({ phone: CUSTOMER, body: "Running 10 min late" });
    expect(r.ok).toBe(true);
    expect(create.mock.calls[0][0].body).toBe("Acme Dental: Running 10 min late Reply STOP to opt out.");
  });

  it("enforces the per-customer daily cap", async () => {
    await seed(A, "inbound");
    for (let i = 0; i < PORTAL_REPLIES_PER_THREAD_PER_DAY; i++) {
      await seed(A, "outbound", CUSTOMER, "portal_reply");
    }
    const r = await send({ phone: CUSTOMER, body: "Hello" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/daily limit/);
    expect(create).not.toHaveBeenCalled();
  });
});
