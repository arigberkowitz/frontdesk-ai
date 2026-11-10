import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Call-problem alerts ("a caller asked for a person and didn't get one")
 * against a real in-process Postgres (PGlite), so the once-per-call claim is
 * the real SQL. Regression: on Nov 10, 2026 Retell's call_ended and
 * call_analyzed webhooks (1.2s apart) each sent the owner the same text and
 * email.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  const pg = new PGlite();
  return { db: drizzle(pg, { schema }), __pg: pg };
});
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test/" } }));
vi.mock("@/lib/push", () => ({ pushToClient: vi.fn(async () => undefined) }));

const recipients = { emails: ["owner@biz.test"], phones: ["+14155559999"] };
vi.mock("@/lib/data/alert-contacts", () => ({
  getAlertRecipients: vi.fn(async () => recipients),
}));
type Res = { ok: boolean; id?: string; skipped?: boolean; error?: string };
const sendEmail = vi.fn(async (_m: { to: string; subject: string; html?: string; text?: string }): Promise<Res> => ({ ok: true, id: "em_1" }));
const sendSms = vi.fn(async (_m: { to: string; body: string }): Promise<Res> => ({ ok: true, id: "sm_1" }));
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail, sendSms } }));

const dbModule = (await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite };
const pg = dbModule.__pg;
const { notifyOwnerCallProblem, CALL_PROBLEM_MAX_AGE_MS } = await import("./notify");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const client = (over: Record<string, unknown> = {}) =>
  ({ id: A, name: "Lawyers for justice", timezone: "America/Los_Angeles", smsAlertsEnabled: true, ...over }) as unknown as import("@/db/schema").Client;
const stranded = { problems: ["stranded_asking_for_human"], notes: ["They asked for a person."] };
const NOW = new Date("2026-11-10T17:57:58Z");
const call = (startAt: Date | null = new Date("2026-11-10T17:56:06Z")) => ({ id: CALL, fromNumber: "+14157475690", startAt });

beforeAll(async () => {
  await pg.exec(`
    CREATE TYPE notification_channel AS ENUM ('email', 'sms');
    CREATE TYPE notification_type AS ENUM ('booking', 'lead', 'digest_daily', 'digest_weekly', 'system');
    CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed');
    CREATE TABLE notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL, type notification_type NOT NULL, channel notification_channel NOT NULL,
      recipient text NOT NULL, payload jsonb, status notification_status NOT NULL DEFAULT 'queued',
      sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
});

beforeEach(async () => {
  await pg.exec(`DELETE FROM notifications;`);
  sendEmail.mockReset();
  sendEmail.mockImplementation(async () => ({ ok: true, id: "em_1" }));
  sendSms.mockReset();
  sendSms.mockImplementation(async () => ({ ok: true, id: "sm_1" }));
  recipients.emails = ["owner@biz.test"];
  recipients.phones = ["+14155559999"];
});

async function rows() {
  const r = await pg.query<{ channel: string; status: string; payload: Record<string, unknown> }>(
    `SELECT channel, status, payload FROM notifications ORDER BY channel`,
  );
  return r.rows;
}

describe("notifyOwnerCallProblem", () => {
  it("texts and emails the owner once, and records the sends", async () => {
    const r = await notifyOwnerCallProblem(client(), call(), stranded, NOW);
    expect(r).toEqual({ status: "sent", email: 1, sms: 1, failed: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const body = sendSms.mock.calls[0]![0].body;
    expect(body).toContain("Lawyers for justice: A caller asked for a person and didn't get one");
    expect(body).toContain("https://app.test/portal/calls/" + CALL);
    const saved = await rows();
    expect(saved.map((x) => [x.channel, x.status, x.payload.kind])).toEqual([
      ["email", "sent", "call_problem"],
      ["sms", "sent", "call_problem"],
    ]);
  });

  it("names the business's time zone so a Pacific call doesn't look 3 hours late in Eastern", async () => {
    await notifyOwnerCallProblem(client(), call(), stranded, NOW);
    expect(sendSms.mock.calls[0]![0].body).toMatch(/9:56\s?AM PST/);
  });

  it("call_ended then call_analyzed for the same call → one text, one email", async () => {
    const first = await notifyOwnerCallProblem(client(), call(), stranded, NOW);
    const second = await notifyOwnerCallProblem(client(), call(), stranded, new Date(NOW.getTime() + 1200));
    expect(first.status).toBe("sent");
    expect(second).toEqual({ status: "duplicate" });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await rows()).toHaveLength(2);
  });

  it("two webhook invocations racing → still one text", async () => {
    const results = await Promise.all([
      notifyOwnerCallProblem(client(), call(), stranded, NOW),
      notifyOwnerCallProblem(client(), call(), stranded, NOW),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["duplicate", "sent"]);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("an alert logged before `kind` existed still counts as already sent", async () => {
    await pg.query(
      `INSERT INTO notifications (client_id, type, channel, recipient, payload, status) VALUES ($1, 'system', 'sms', '+14155559999', $2, 'sent')`,
      [A, JSON.stringify({ body: "old", callId: CALL })],
    );
    expect(await notifyOwnerCallProblem(client(), call(), stranded, NOW)).toEqual({ status: "duplicate" });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("a call recap for the same call doesn't block the problem alert", async () => {
    await pg.query(
      `INSERT INTO notifications (client_id, type, channel, recipient, payload, status) VALUES ($1, 'system', 'email', 'owner@biz.test', $2, 'sent')`,
      [A, JSON.stringify({ kind: "call_recap", callId: CALL })],
    );
    expect((await notifyOwnerCallProblem(client(), call(), stranded, NOW)).status).toBe("sent");
  });

  it("a failed send can be retried by a later event", async () => {
    sendSms.mockImplementationOnce(async () => ({ ok: false, error: "twilio down" }));
    sendEmail.mockImplementationOnce(async () => ({ ok: false, error: "resend down" }));
    expect(await notifyOwnerCallProblem(client(), call(), stranded, NOW)).toEqual({
      status: "sent", email: 0, sms: 0, failed: 2,
    });
    expect((await notifyOwnerCallProblem(client(), call(), stranded, NOW)).status).toBe("sent");
    expect(sendSms).toHaveBeenCalledTimes(2);
  });

  it("doesn't text about a call hours later (replayed or reprocessed webhook)", async () => {
    const late = new Date(new Date("2026-11-10T17:56:06Z").getTime() + CALL_PROBLEM_MAX_AGE_MS + 60_000);
    expect(await notifyOwnerCallProblem(client(), call(), stranded, late)).toEqual({ status: "stale" });
    expect(sendSms).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it("not a problem call → nothing sent", async () => {
    expect(await notifyOwnerCallProblem(client(), call(), { problems: [], notes: [] }, NOW)).toEqual({
      status: "not_a_problem",
    });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("SMS alerts off → email only", async () => {
    const r = await notifyOwnerCallProblem(client({ smsAlertsEnabled: false }), call(), stranded, NOW);
    expect(r).toEqual({ status: "sent", email: 1, sms: 0, failed: 0 });
    expect(sendSms).not.toHaveBeenCalled();
  });
});
