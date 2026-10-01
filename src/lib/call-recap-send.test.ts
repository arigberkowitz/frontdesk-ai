import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Call recaps against a real (in-process) Postgres — PGlite — so the lookups,
 * the once-per-call claim and the notifications rows are the real SQL.
 */

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  const pg = new PGlite();
  return { db: drizzle(pg, { schema }), __pg: pg };
});
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test/" } }));

const recipients = { emails: ["owner@biz.test"], phones: ["+14155559999"] };
vi.mock("@/lib/data/alert-contacts", () => ({
  getAlertRecipients: vi.fn(async () => recipients),
}));
type Res = { ok: boolean; id?: string; skipped?: boolean };
const sendEmail = vi.fn(async (_m: { to: string; subject: string; html?: string; text?: string }): Promise<Res> => ({ ok: true, id: "em_1" }));
const sendSms = vi.fn(async (_m: { to: string; body: string }): Promise<Res> => ({ ok: true, id: "sm_1" }));
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail, sendSms } }));

const dbModule = (await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite };
const pg = dbModule.__pg;
const { sendCallRecap } = await import("./call-recap-send");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OLD_CALL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const client = (over: Record<string, unknown> = {}) =>
  ({ id: A, name: "Bright Smiles", timezone: "America/New_York", ownerEmail: "owner@biz.test", smsAlertsEnabled: true, ...over }) as unknown as import("@/db/schema").Client;

beforeAll(async () => {
  await pg.exec(`
    CREATE TYPE notification_channel AS ENUM ('email', 'sms');
    CREATE TYPE notification_type AS ENUM ('booking', 'lead', 'digest_daily', 'digest_weekly', 'system');
    CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed');
    CREATE TYPE call_direction AS ENUM ('inbound', 'outbound');
    CREATE TYPE appointment_status AS ENUM ('booked', 'confirmed', 'cancelled', 'no_show');
    CREATE TABLE notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL, type notification_type NOT NULL, channel notification_channel NOT NULL,
      recipient text NOT NULL, payload jsonb, status notification_status NOT NULL DEFAULT 'queued',
      sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE calls (
      id uuid PRIMARY KEY, client_id uuid NOT NULL, direction call_direction NOT NULL DEFAULT 'inbound',
      from_number text, to_number text, start_at timestamptz, summary text, deleted_at timestamptz
    );
    CREATE TABLE leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, call_id uuid,
      name text, phone text, reason text, message text, service text, urgency text,
      created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    );
    CREATE TABLE call_insights (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), call_id uuid NOT NULL, client_id uuid NOT NULL,
      entities jsonb, follow_up_draft text
    );
    CREATE TABLE appointments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, customer_name text,
      customer_phone text, start_at timestamptz NOT NULL, status appointment_status NOT NULL DEFAULT 'booked',
      created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
    );
  `);
});

beforeEach(async () => {
  await pg.exec(`DELETE FROM notifications; DELETE FROM calls; DELETE FROM leads; DELETE FROM call_insights; DELETE FROM appointments;`);
  await pg.exec(`
    INSERT INTO calls (id, client_id, from_number, start_at, summary) VALUES
      ('${CALL}', '${A}', '+14155550100', now() - interval '5 minutes', 'Caller wants a crown fixed.'),
      ('${OLD_CALL}', '${A}', '(415) 555-0100', now() - interval '30 days', null);
    INSERT INTO appointments (client_id, customer_name, customer_phone, start_at, status) VALUES
      ('${A}', 'Pat Lee', '4155550100', now() - interval '60 days', 'confirmed'),
      ('${A}', 'Pat Lee', '4155550100', now() - interval '20 days', 'cancelled');
  `);
  sendEmail.mockClear();
  sendSms.mockClear();
  recipients.emails = ["owner@biz.test"];
  recipients.phones = ["+14155559999"];
});

async function addLead(urgency = "this week") {
  await pg.query(
    `INSERT INTO leads (client_id, call_id, name, phone, reason, message, urgency) VALUES ($1, $2, 'Pat', '+14155550100', 'Crown fell out', 'Call after 3', $3)`,
    [A, CALL, urgency],
  );
  await pg.query(
    `INSERT INTO call_insights (call_id, client_id, entities, follow_up_draft) VALUES ($1, $2, $3, 'Hi Pat — we can fit you in Thursday at 3.')`,
    [CALL, A, JSON.stringify({ name: "Pat", service: "Crown repair", requestedDate: "Thursday", phone: "", budget: "" })],
  );
}

describe("sendCallRecap", () => {
  it("a message: emails + texts the alert contacts once, with the full recap", async () => {
    await addLead();
    const r = await sendCallRecap(client(), CALL, { kind: "message", problems: [] });
    expect(r).toEqual({ status: "sent", email: 1, sms: 1, failed: 0 });
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.subject).toBe("Pat left a message · Bright Smiles");
    expect(mail.text).toContain("Existing customer · 1 past appointment");
    expect(mail.text).toContain("Wants: Crown fell out — Crown repair (asked for: Thursday)");
    expect(mail.text).toContain("Text back: “Hi Pat — we can fit you in Thursday at 3.”");
    expect(mail.text).toContain(`https://app.test/portal/calls/${CALL}`);
    expect(sendSms.mock.calls[0][0].to).toBe("+14155559999");

    const rows = await pg.query<{ type: string; channel: string; status: string; payload: Record<string, unknown> }>(
      `SELECT type, channel, status, payload FROM notifications ORDER BY channel`,
    );
    expect(rows.rows.map((x) => [x.type, x.channel, x.status])).toEqual([
      ["lead", "email", "sent"],
      ["lead", "sms", "sent"],
    ]);
    expect(rows.rows[0].payload).toMatchObject({ kind: "call_recap", callId: CALL, recapKind: "message" });
  });

  it("is once per call — a replay or concurrent retry sends nothing more", async () => {
    await addLead();
    const results = await Promise.all([1, 2, 3].map(() => sendCallRecap(client(), CALL, { kind: "message", problems: [] })));
    expect(results.filter((x) => x.status === "sent")).toHaveLength(1);
    expect(results.filter((x) => x.status === "duplicate")).toHaveLength(2);
    expect(await sendCallRecap(client(), CALL, { kind: "message", problems: [] })).toEqual({ status: "duplicate" });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a failed send doesn't block a retry", async () => {
    await addLead();
    sendEmail.mockResolvedValueOnce({ ok: false });
    sendSms.mockResolvedValueOnce({ ok: false });
    expect(await sendCallRecap(client(), CALL, { kind: "message", problems: [] })).toMatchObject({ failed: 2 });
    expect(await sendCallRecap(client(), CALL, { kind: "message", problems: [] })).toMatchObject({ status: "sent", email: 1, sms: 1 });
  });

  it("never texts when SMS alerts are off", async () => {
    await addLead("ASAP");
    await sendCallRecap(client({ smsAlertsEnabled: false }), CALL, { kind: "message", problems: ["possible_emergency"] });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("a connected transfer is email only", async () => {
    const r = await sendCallRecap(client(), CALL, { kind: "transfer", problems: [] });
    expect(r).toEqual({ status: "sent", email: 1, sms: 0, failed: 0 });
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendEmail.mock.calls[0][0].subject).toBe("Pat Lee was transferred to your team · Bright Smiles");
    expect(sendEmail.mock.calls[0][0].text).toContain("Wants: Caller wants a crown fixed.");
    const rows = await pg.query<{ type: string }>(`SELECT type FROM notifications`);
    expect(rows.rows).toEqual([{ type: "system" }]);
  });

  it("a failed transfer texts when SMS alerts are on (as the stranded-caller alert did)", async () => {
    await sendCallRecap(client(), CALL, { kind: "transfer_failed", problems: ["transferred_to_voicemail"] });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms.mock.calls[0][0].body).toContain("tried to reach a person");
  });

  it("other businesses' calls are not found", async () => {
    const r = await sendCallRecap(client({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), CALL, { kind: "transfer", problems: [] });
    expect(r).toEqual({ status: "not_found" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("no recipients → nothing claimed", async () => {
    recipients.emails = [];
    recipients.phones = [];
    expect(await sendCallRecap(client(), CALL, { kind: "message", problems: [] })).toEqual({ status: "no_recipient" });
    const rows = await pg.query(`SELECT 1 FROM notifications`);
    expect(rows.rows).toHaveLength(0);
  });
});
