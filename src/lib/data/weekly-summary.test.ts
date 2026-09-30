import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Weekly summary data layer against a real (in-process) Postgres — PGlite —
 * with the actual manual migrations applied (0007 sms_messages, 0008 weekly
 * summary), so the dedupe index and the counting SQL are exercised for real.
 */

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  const pg = new PGlite();
  return { db: drizzle(pg, { schema }), __pg: pg };
});

const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const data = await import("./weekly-summary");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const read = (f: string) => readFileSync(path.resolve(__dirname, "../../../drizzle/manual", f), "utf8");
const M7 = read("0007_sms_messages.sql");
const M8 = read("0008_weekly_summary.sql");

beforeAll(async () => {
  await pg.exec(`
    CREATE TABLE clients (id uuid PRIMARY KEY);
    CREATE TYPE appointment_status AS ENUM ('booked','confirmed','cancelled','no_show');
    CREATE TABLE appointments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL,
      status appointment_status NOT NULL DEFAULT 'booked',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE TABLE leads (id uuid PRIMARY KEY);
    INSERT INTO clients (id) VALUES ('${A}'), ('${B}');
  `);
  await pg.exec(M7);
  await pg.exec(M8);
});

beforeEach(async () => {
  await pg.exec(`DELETE FROM weekly_summary_sends; DELETE FROM sms_messages; DELETE FROM appointments;`);
});

describe("migration 0008_weekly_summary", () => {
  it("is idempotent — running it again is a no-op", async () => {
    await expect(pg.exec(M8)).resolves.toBeDefined();
  });

  it("adds weekly_summary_enabled defaulting to on", async () => {
    const r = await pg.query<{ weekly_summary_enabled: boolean }>(
      `SELECT weekly_summary_enabled FROM clients WHERE id = '${A}'`,
    );
    expect(r.rows[0].weekly_summary_enabled).toBe(true);
  });
});

describe("claimWeeklySummary", () => {
  it("claims a week once; a second run the same week gets nothing", async () => {
    const first = await data.claimWeeklySummary(A, "2026-W40", "o@a.test");
    const second = await data.claimWeeklySummary(A, "2026-W40", "o@a.test");
    expect(first).toBeTruthy();
    expect(second).toBeNull();
  });

  it("stays claimed after a successful send", async () => {
    const id = (await data.claimWeeklySummary(A, "2026-W40", "o@a.test"))!;
    await data.finishWeeklySummary(id, { status: "sent", stats: { calls: 1 } });
    expect(await data.claimWeeklySummary(A, "2026-W40", "o@a.test")).toBeNull();
  });

  it("lets a failed or provider-skipped week be retried", async () => {
    const id = (await data.claimWeeklySummary(A, "2026-W40", "o@a.test"))!;
    await data.finishWeeklySummary(id, { status: "failed", error: "boom" });
    const retry = await data.claimWeeklySummary(A, "2026-W40", "o@a.test");
    expect(retry).toBe(id);
    await data.finishWeeklySummary(id, { status: "skipped" });
    expect(await data.claimWeeklySummary(A, "2026-W40", "o@a.test")).toBe(id);
  });

  it("is per business and per week", async () => {
    expect(await data.claimWeeklySummary(A, "2026-W40", "o@a.test")).toBeTruthy();
    expect(await data.claimWeeklySummary(B, "2026-W40", "o@b.test")).toBeTruthy();
    expect(await data.claimWeeklySummary(A, "2026-W41", "o@a.test")).toBeTruthy();
  });

  it("concurrent claims for the same week: exactly one wins", async () => {
    const results = await Promise.all([1, 2, 3].map(() => data.claimWeeklySummary(A, "2026-W40", "o@a.test")));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("getWeeklyActivity", () => {
  async function sms(client: string, dir: "inbound" | "outbound", phone: string, kind: string, ago: string) {
    await pg.query(
      `INSERT INTO sms_messages (client_id, direction, customer_phone, body, status, kind, created_at)
       VALUES ($1, $2, $3, 'x', $4, $5, now() - $6::interval)`,
      [client, dir, phone, dir === "inbound" ? "received" : "sent", kind, ago],
    );
  }

  it("counts bookings made and cancellations in the window, scoped to the business", async () => {
    await pg.exec(`
      INSERT INTO appointments (client_id, status, created_at) VALUES
        ('${A}', 'booked', now() - interval '1 day'),
        ('${A}', 'confirmed', now() - interval '6 days'),
        ('${A}', 'booked', now() - interval '9 days'),          -- too old
        ('${A}', 'no_show', now() - interval '2 days');          -- not a booking
      INSERT INTO appointments (client_id, status, created_at, updated_at) VALUES
        ('${A}', 'cancelled', now() - interval '20 days', now() - interval '2 days'),
        ('${A}', 'cancelled', now() - interval '20 days', now() - interval '12 days'); -- cancelled long ago
      INSERT INTO appointments (client_id, status, created_at, deleted_at) VALUES
        ('${A}', 'booked', now() - interval '1 day', now());      -- deleted
      INSERT INTO appointments (client_id, status) VALUES ('${B}', 'booked'), ('${B}', 'cancelled');
    `);
    const a = await data.getWeeklyActivity(A);
    expect(a.bookingsMade).toBe(2);
    expect(a.cancellations).toBe(1);
  });

  it("counts inbound texts, and 'won back' only for replies to a recent recovery text", async () => {
    // Won back: recovery text, then a reply.
    await sms(A, "outbound", "14155550001", "recovery_lead", "3 days");
    await sms(A, "inbound", "14155550001", "reply", "2 days");
    await sms(A, "inbound", "14155550001", "reply", "1 day"); // same person — counted once
    // No-show recovery also counts.
    await sms(A, "outbound", "14155550002", "recovery_no_show", "5 days");
    await sms(A, "inbound", "14155550002", "opt_in", "4 days");
    // STOP after a recovery text is not "won back".
    await sms(A, "outbound", "14155550003", "recovery_lead", "3 days");
    await sms(A, "inbound", "14155550003", "opt_out", "2 days");
    // A reply to a normal reminder is a text, not a recovery.
    await sms(A, "outbound", "14155550004", "appointment_reminder", "3 days");
    await sms(A, "inbound", "14155550004", "reply", "2 days");
    // Recovery text too long before the reply.
    await sms(A, "outbound", "14155550005", "recovery_lead", "30 days");
    await sms(A, "inbound", "14155550005", "reply", "1 day");
    // Old inbound — outside the window.
    await sms(A, "inbound", "14155550006", "reply", "10 days");
    // Another business's recovery doesn't count for A.
    await sms(B, "outbound", "14155550007", "recovery_lead", "3 days");
    await sms(A, "inbound", "14155550007", "reply", "2 days");

    const a = await data.getWeeklyActivity(A);
    expect(a.textsReceived).toBe(7);
    expect(a.missedRecovered).toBe(2);
    const b = await data.getWeeklyActivity(B);
    expect(b).toMatchObject({ textsReceived: 0, missedRecovered: 0 });
  });
});
