import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reply alerts against a real (in-process) Postgres — PGlite — so the throttle
 * query, the advisory lock and the notifications rows are the real SQL.
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
const sendEmail = vi.fn(async (_m: { to: string; subject: string; html?: string; text?: string }) => ({
  ok: true,
  id: "em_1",
}) as { ok: boolean; id?: string; skipped?: boolean });
const sendSms = vi.fn();
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail, sendSms } }));

const dbModule = (await import("@/db")) as unknown as {
  __pg: import("@electric-sql/pglite").PGlite;
};
const pg = dbModule.__pg;
const { notifyOwnerTextReply, replyAlertEmail, REPLY_ALERT_THROTTLE_MINUTES } = await import(
  "./reply-alerts"
);

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const client = (id: string) =>
  ({ id, name: "Bright Smiles", ownerEmail: "owner@biz.test" }) as unknown as import("@/db/schema").Client;

beforeAll(async () => {
  await pg.exec(`
    CREATE TYPE notification_channel AS ENUM ('email', 'sms');
    CREATE TYPE notification_type AS ENUM ('booking', 'lead', 'digest_daily', 'digest_weekly', 'system');
    CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed');
    CREATE TABLE notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL,
      type notification_type NOT NULL,
      channel notification_channel NOT NULL,
      recipient text NOT NULL,
      payload jsonb,
      status notification_status NOT NULL DEFAULT 'queued',
      sent_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
});

beforeEach(async () => {
  await pg.exec(`DELETE FROM notifications;`);
  sendEmail.mockClear();
  sendSms.mockClear();
  recipients.emails = ["owner@biz.test"];
});

const input = (body = "Can we move to 3pm?", customerPhone = "14155550100") => ({
  customerPhone,
  body,
  name: "Pat",
  followUpsPaused: true,
});

describe("notifyOwnerTextReply", () => {
  it("emails the alert recipients, never texts, and records the notification", async () => {
    const r = await notifyOwnerTextReply(client(A), input());
    expect(r).toEqual({ status: "sent", sent: 1, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendSms).not.toHaveBeenCalled();
    const msg = sendEmail.mock.calls[0][0];
    expect(msg.to).toBe("owner@biz.test");
    expect(msg.text).toContain("https://app.test/portal/messages/14155550100");
    const rows = await pg.query<{ status: string; type: string; channel: string; payload: Record<string, string> }>(
      `SELECT status, type, channel, payload FROM notifications`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ status: "sent", type: "system", channel: "email" });
    expect(rows.rows[0].payload).toMatchObject({ kind: "sms_reply", customerPhone: "14155550100" });
  });

  it("sends one email per recipient on the roster", async () => {
    recipients.emails = ["a@biz.test", "b@biz.test"];
    const r = await notifyOwnerTextReply(client(A), input());
    expect(r).toMatchObject({ status: "sent", sent: 2 });
    expect(sendEmail.mock.calls.map((c) => c[0].to).sort()).toEqual(["a@biz.test", "b@biz.test"]);
  });

  it("a burst in one conversation sends one alert", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await notifyOwnerTextReply(client(A), input(`msg ${i}`)));
    expect(results.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(results.filter((r) => r.status === "throttled")).toHaveLength(4);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("concurrent texts in one conversation still send one alert", async () => {
    const results = await Promise.all(
      [1, 2, 3].map((i) => notifyOwnerTextReply(client(A), input(`msg ${i}`))),
    );
    expect(results.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("throttles per conversation, not per business", async () => {
    await notifyOwnerTextReply(client(A), input("hi", "14155550100"));
    await notifyOwnerTextReply(client(A), input("hi", "14155550111"));
    await notifyOwnerTextReply(client(B), input("hi", "14155550100"));
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });

  it(`alerts again once ${REPLY_ALERT_THROTTLE_MINUTES} minutes have passed`, async () => {
    await notifyOwnerTextReply(client(A), input());
    await pg.exec(`UPDATE notifications SET created_at = now() - interval '16 minutes'`);
    const r = await notifyOwnerTextReply(client(A), input("still there?"));
    expect(r.status).toBe("sent");
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("a failed send doesn't throttle the next text", async () => {
    sendEmail.mockResolvedValueOnce({ ok: false });
    const first = await notifyOwnerTextReply(client(A), input());
    expect(first).toMatchObject({ status: "sent", sent: 0, failed: 1 });
    const second = await notifyOwnerTextReply(client(A), input("hello?"));
    expect(second).toMatchObject({ status: "sent", sent: 1 });
  });

  it("does nothing without an email recipient (and still never texts)", async () => {
    recipients.emails = [];
    const r = await notifyOwnerTextReply(client(A), input());
    expect(r).toEqual({ status: "no_recipient" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(sendSms).not.toHaveBeenCalled();
  });
});

describe("replyAlertEmail", () => {
  const base = {
    business: "Bright Smiles",
    name: null,
    customerPhone: "14155550100",
    body: "Hi <b>there</b>",
    link: "https://app.test/portal/messages/14155550100",
    followUpsPaused: false,
  };

  it("uses the formatted phone when there's no name and escapes the message", () => {
    const e = replyAlertEmail(base);
    expect(e.subject).toContain("(415) 555-0100 texted Bright Smiles");
    expect(e.html).toContain("Hi &lt;b&gt;there&lt;/b&gt;");
    expect(e.html).not.toContain("<b>there</b>");
    expect(e.html).not.toContain("paused");
  });

  it("names the contact, truncates long subjects, and mentions paused follow-ups", () => {
    const e = replyAlertEmail({ ...base, name: "Pat", body: "x".repeat(200), followUpsPaused: true });
    expect(e.subject.startsWith("Pat texted")).toBe(true);
    expect(e.subject.length).toBeLessThan(110);
    expect(e.text).toContain("paused");
    expect(e.text).toContain(base.link);
  });
});
