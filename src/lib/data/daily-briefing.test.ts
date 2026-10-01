import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Daily briefing data layer against a real (in-process) Postgres — PGlite —
 * so the per-day claim (advisory lock + notifications row), the stored card
 * and the business-local windows are the real SQL.
 */

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  const pg = new PGlite();
  return { db: drizzle(pg, { schema }), __pg: pg };
});

const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const data = await import("./daily-briefing");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NY = "America/New_York";
// 7:30am EDT on Sep 30 → "yesterday" is Sep 29 04:00Z .. Sep 30 04:00Z.
const NOW = new Date("2026-09-30T11:30:00Z");
const card = (dayKey: string) => ({
  dayKey,
  opening: "Hello",
  quiet: false,
  callbacks: [],
  todayCount: 1,
  calls: 2,
  bookingsMade: 1,
  cancellations: 0,
});

beforeAll(async () => {
  await pg.exec(`
    CREATE TYPE notification_channel AS ENUM ('email', 'sms');
    CREATE TYPE notification_type AS ENUM ('booking', 'lead', 'digest_daily', 'digest_weekly', 'system');
    CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'failed');
    CREATE TYPE call_direction AS ENUM ('inbound', 'outbound');
    CREATE TYPE call_outcome AS ENUM ('booked','lead','faq_answered','escalated','spam','missed','other');
    CREATE TYPE appointment_status AS ENUM ('booked','confirmed','cancelled','no_show');
    CREATE TYPE lead_status AS ENUM ('new','contacted','won','lost');
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
    CREATE TABLE services (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
    CREATE TABLE calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL,
      direction call_direction NOT NULL DEFAULT 'inbound',
      from_number text,
      start_at timestamptz,
      transcript text,
      duration_sec int,
      outcome call_outcome,
      is_after_hours boolean NOT NULL DEFAULT false,
      deleted_at timestamptz
    );
    CREATE TABLE appointments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL,
      service_id uuid,
      customer_name text,
      start_at timestamptz NOT NULL,
      status appointment_status NOT NULL DEFAULT 'booked',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE TABLE leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL,
      call_id uuid,
      name text, phone text, reason text, message text, urgency text,
      status lead_status NOT NULL DEFAULT 'new',
      last_reply_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
  `);
});

beforeEach(async () => {
  await pg.exec(`DELETE FROM notifications; DELETE FROM calls; DELETE FROM appointments; DELETE FROM leads; DELETE FROM services;`);
});

describe("claimDailyBriefing", () => {
  it("claims a business's day once; a second slot the same day gets nothing", async () => {
    expect(await data.claimDailyBriefing(A, "2026-09-30", "o@a.test")).toBeTruthy();
    expect(await data.claimDailyBriefing(A, "2026-09-30", "o@a.test")).toBeNull();
    // Another business, or the next day, is independent.
    expect(await data.claimDailyBriefing(B, "2026-09-30", "o@b.test")).toBeTruthy();
    expect(await data.claimDailyBriefing(A, "2026-10-01", "o@a.test")).toBeTruthy();
  });

  it("concurrent slots can't both claim", async () => {
    const results = await Promise.all([
      data.claimDailyBriefing(A, "2026-09-30", "o@a.test"),
      data.claimDailyBriefing(A, "2026-09-30", "o@a.test"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("a sent day stays claimed; a failed or provider-skipped day can be retried", async () => {
    const sent = (await data.claimDailyBriefing(A, "2026-09-30", "o@a.test"))!;
    await data.finishDailyBriefing(sent, { status: "sent", dayKey: "2026-09-30", subject: "s", card: card("2026-09-30"), usedAi: true });
    expect(await data.claimDailyBriefing(A, "2026-09-30", "o@a.test")).toBeNull();

    const failed = (await data.claimDailyBriefing(B, "2026-09-30", "o@b.test"))!;
    await data.finishDailyBriefing(failed, { status: "failed", dayKey: "2026-09-30", subject: "s", card: card("2026-09-30"), usedAi: false, error: "boom" });
    const retry = (await data.claimDailyBriefing(B, "2026-09-30", "o@b.test"))!;
    expect(retry).toBeTruthy();
    await data.finishDailyBriefing(retry, { status: "skipped", dayKey: "2026-09-30", subject: "s", card: card("2026-09-30"), usedAi: false });
    expect(await data.claimDailyBriefing(B, "2026-09-30", "o@b.test")).toBeTruthy();
  });

  it("records the row as a digest_daily email with the card for the Overview", async () => {
    const id = (await data.claimDailyBriefing(A, "2026-09-30", "o@a.test"))!;
    expect(await data.getStoredBriefingCard(A, "2026-09-30")).toBeNull(); // claimed, not written yet
    await data.finishDailyBriefing(id, { status: "sent", dayKey: "2026-09-30", subject: "s", card: card("2026-09-30"), usedAi: true });
    const r = await pg.query<{ type: string; channel: string; status: string }>(`SELECT type, channel, status FROM notifications`);
    expect(r.rows).toEqual([{ type: "digest_daily", channel: "email", status: "sent" }]);
    expect((await data.getStoredBriefingCard(A, "2026-09-30"))?.opening).toBe("Hello");
    expect(await data.getStoredBriefingCard(B, "2026-09-30")).toBeNull();
    expect(await data.getStoredBriefingCard(A, "2026-10-01")).toBeNull();
  });
});

describe("getBriefingFacts", () => {
  it("counts yesterday in the business's zone, lists today's schedule and who needs a callback", async () => {
    await pg.exec(`
      INSERT INTO services (id, name) VALUES ('11111111-1111-4111-8111-111111111111', 'Leak repair');
      -- yesterday (local): inside 04:00Z Sep 29 .. 04:00Z Sep 30
      INSERT INTO calls (client_id, start_at, outcome, is_after_hours) VALUES
        ('${A}', '2026-09-29T15:00:00Z', 'booked', false),
        ('${A}', '2026-09-30T02:00:00Z', 'lead', true),     -- 10pm local, still yesterday
        ('${A}', '2026-09-29T16:00:00Z', 'spam', false),
        ('${A}', '2026-09-29T03:59:00Z', 'booked', false),  -- day before yesterday (local)
        ('${A}', '2026-09-30T05:00:00Z', 'booked', false),  -- today (local)
        ('${B}', '2026-09-29T15:00:00Z', 'booked', false);  -- other business
      INSERT INTO calls (client_id, start_at, outcome, from_number, duration_sec, transcript) VALUES
        ('${A}', '2026-09-29T17:00:00Z', 'faq_answered', '+14155550199', 40,
         E'User: can I talk to a real person\\nAgent: One moment while I connect you.\\nTransfer Target: The person you are trying to reach is not available, please leave a message at the tone');
      INSERT INTO appointments (client_id, service_id, customer_name, start_at, status, created_at, updated_at) VALUES
        ('${A}', '11111111-1111-4111-8111-111111111111', 'Ana', '2026-09-30T13:00:00Z', 'booked', '2026-09-29T15:00:00Z', '2026-09-29T15:00:00Z'),
        ('${A}', NULL, 'Ben', '2026-09-30T20:00:00Z', 'confirmed', '2026-09-20T15:00:00Z', '2026-09-20T15:00:00Z'),
        ('${A}', NULL, 'Cy', '2026-10-01T05:00:00Z', 'booked', '2026-09-29T15:00:00Z', '2026-09-29T15:00:00Z'),
        ('${A}', NULL, 'Dee', '2026-10-03T13:00:00Z', 'cancelled', '2026-09-20T15:00:00Z', '2026-09-29T18:00:00Z'),
        ('${B}', NULL, 'Eve', '2026-09-30T13:00:00Z', 'booked', '2026-09-29T15:00:00Z', '2026-09-29T15:00:00Z');
      INSERT INTO leads (client_id, name, phone, reason, urgency, status, created_at, last_reply_at) VALUES
        ('${A}', 'Pat', '+14155550100', 'Water everywhere, basement flooding', 'ASAP', 'new', '2026-09-29T20:00:00Z', NULL),
        ('${A}', 'Old', '+14155550101', 'Quote', NULL, 'new', '2026-09-10T20:00:00Z', NULL),
        ('${A}', 'Done', '+14155550102', 'Quote', NULL, 'contacted', '2026-09-29T20:00:00Z', NULL),
        ('${A}', 'Replied', '+14155550103', 'Quote', NULL, 'new', '2026-09-29T20:00:00Z', '2026-09-29T21:00:00Z');
    `);
    const f = await data.getBriefingFacts({ id: A, name: "Harbor", timezone: NY }, NOW);
    expect(f.dayKey).toBe("2026-09-30");
    expect(f.counts).toEqual({
      calls: 4,
      booked: 1,
      messages: 1,
      afterHours: 1,
      spam: 1,
      bookingsMade: 2, // Ana + Cy were created yesterday
      cancellations: 1,
    });
    expect(f.today.map((a) => [a.customerName, a.service])).toEqual([
      ["Ana", "Leak repair"],
      ["Ben", null],
    ]);
    expect(f.cancellations.map((a) => a.customerName)).toEqual(["Dee"]);
    // Open, unreplied message from the last week + the transfer that hit voicemail.
    expect(f.callbacks.map((c) => [c.ref, c.kind, c.name ?? c.phone, c.urgent])).toEqual([
      ["C1", "message", "Pat", true],
      ["C2", "transfer_failed", "+14155550199", false],
    ]);
  });
});
