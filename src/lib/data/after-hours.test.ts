import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getAfterHoursWeek against a real in-process Postgres (PGlite), so the
 * counting SQL — windows, spam/missed exclusion, booked vs message — runs for
 * real. Fake data only.
 */

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("@/db/schema");
  const pg = new PGlite();
  return { db: drizzle(pg, { schema }), __pg: pg };
});

const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const { getAfterHoursWeek } = await import("./after-hours");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeAll(async () => {
  await pg.exec(`
    CREATE TYPE call_direction AS ENUM ('inbound','outbound');
    CREATE TYPE call_outcome AS ENUM ('booked','lead','faq_answered','escalated','spam','missed','other');
    CREATE TYPE appointment_status AS ENUM ('booked','confirmed','cancelled','no_show');
    CREATE TABLE business_hours (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, day_of_week int NOT NULL);
    CREATE TABLE calls (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL,
      direction call_direction NOT NULL DEFAULT 'inbound',
      start_at timestamptz,
      outcome call_outcome,
      is_after_hours boolean NOT NULL DEFAULT false,
      deleted_at timestamptz
    );
    CREATE TABLE appointments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL, call_id uuid, service_id uuid,
      status appointment_status NOT NULL DEFAULT 'booked',
      deleted_at timestamptz
    );
    CREATE TABLE services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL, name text NOT NULL,
      price_cents int, price_max_cents int, price_from boolean NOT NULL DEFAULT false
    );
    CREATE TABLE leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id uuid NOT NULL, call_id uuid, deleted_at timestamptz
    );
  `);
});

beforeEach(async () => {
  await pg.exec(`DELETE FROM calls; DELETE FROM appointments; DELETE FROM leads; DELETE FROM business_hours; DELETE FROM services;
    INSERT INTO business_hours (client_id, day_of_week) VALUES ('${A}', 1);`);
});

async function call(
  o: { client?: string; ago: string; outcome?: string | null; afterHours?: boolean; dir?: string; deleted?: boolean },
): Promise<string> {
  const r = await pg.query<{ id: string }>(
    `INSERT INTO calls (client_id, direction, start_at, outcome, is_after_hours, deleted_at)
     VALUES ($1, $2::call_direction, now() - $3::interval, $4::call_outcome, $5, $6) RETURNING id`,
    [o.client ?? A, o.dir ?? "inbound", o.ago, o.outcome ?? null, o.afterHours ?? true, o.deleted ? new Date().toISOString() : null],
  );
  return r.rows[0].id;
}

describe("getAfterHoursWeek", () => {
  it("is null when the business has no opening hours saved", async () => {
    await call({ client: B, ago: "1 day", outcome: "booked" });
    expect(await getAfterHoursWeek(B)).toBeNull();
  });

  it("counts answered, booked and messages for the last 7 days only", async () => {
    await call({ ago: "1 day", outcome: "booked" });
    const viaAppt = await call({ ago: "2 days", outcome: "faq_answered" });
    await pg.query(`INSERT INTO appointments (client_id, call_id) VALUES ($1, $2)`, [A, viaAppt]);
    const cancelled = await call({ ago: "2 days", outcome: "other" });
    await pg.query(`INSERT INTO appointments (client_id, call_id, status) VALUES ($1, $2, 'cancelled')`, [A, cancelled]);
    await call({ ago: "3 days", outcome: "lead" });
    const viaLead = await call({ ago: "3 days", outcome: "escalated" });
    await pg.query(`INSERT INTO leads (client_id, call_id) VALUES ($1, $2)`, [A, viaLead]);
    // Booked AND left a lead: counted as booked, not twice.
    const both = await call({ ago: "4 days", outcome: "booked" });
    await pg.query(`INSERT INTO leads (client_id, call_id) VALUES ($1, $2)`, [A, both]);
    await call({ ago: "5 days", outcome: null });

    // Not counted.
    await call({ ago: "1 day", outcome: "spam" });
    await call({ ago: "1 day", outcome: "missed" });
    await call({ ago: "1 day", outcome: "booked", afterHours: false });
    await call({ ago: "1 day", outcome: "booked", dir: "outbound" });
    await call({ ago: "1 day", outcome: "booked", deleted: true });
    await call({ client: B, ago: "1 day", outcome: "booked" });
    await call({ ago: "20 days", outcome: "booked" });

    // The week before.
    await call({ ago: "8 days", outcome: "booked" });
    await call({ ago: "10 days", outcome: "lead" });
    await call({ ago: "13 days", outcome: "spam" });

    expect(await getAfterHoursWeek(A)).toEqual({
      answered: 7,
      booked: 3,
      messages: 2,
      prior: { answered: 2, booked: 1 },
      // None of those bookings has a priced service on it: no money line.
      value: { priced: 0, cents: 0, atLeast: false },
    });
  });

  it("returns zeros, not null, for a quiet week with hours saved", async () => {
    expect(await getAfterHoursWeek(A)).toEqual({
      answered: 0,
      booked: 0,
      messages: 0,
      prior: { answered: 0, booked: 0 },
      value: { priced: 0, cents: 0, atLeast: false },
    });
  });

  describe("value at listed prices", () => {
    async function service(price: number | null, o: { client?: string; from?: boolean; max?: number } = {}) {
      const r = await pg.query<{ id: string }>(
        `INSERT INTO services (client_id, name, price_cents, price_max_cents, price_from) VALUES ($1, 'Svc', $2, $3, $4) RETURNING id`,
        [o.client ?? A, price, o.max ?? null, o.from ?? false],
      );
      return r.rows[0].id;
    }
    async function appt(callId: string, serviceId: string | null, status = "booked", deleted = false) {
      await pg.query(
        `INSERT INTO appointments (client_id, call_id, service_id, status, deleted_at) VALUES ($1, $2, $3, $4::appointment_status, $5)`,
        [A, callId, serviceId, status, deleted ? new Date().toISOString() : null],
      );
    }

    it("sums only booked after-hours calls whose service has a listed price", async () => {
      const cut = await service(4500);
      const color = await service(15000);
      const noPrice = await service(null);
      await appt(await call({ ago: "1 day", outcome: "booked" }), cut);
      await appt(await call({ ago: "2 days", outcome: "booked" }), color);
      await appt(await call({ ago: "2 days", outcome: "booked" }), noPrice); // unpriced
      await call({ ago: "3 days", outcome: "booked" }); // booked, no appointment row: unpriced

      // Not counted: cancelled, deleted, last week, daytime, spam.
      await appt(await call({ ago: "1 day", outcome: "other" }), color, "cancelled");
      await appt(await call({ ago: "1 day", outcome: "other" }), color, "booked", true);
      await appt(await call({ ago: "9 days", outcome: "booked" }), color);
      await appt(await call({ ago: "1 day", outcome: "booked", afterHours: false }), color);
      await appt(await call({ ago: "1 day", outcome: "spam" }), color);

      const w = await getAfterHoursWeek(A);
      expect(w?.booked).toBe(4);
      expect(w?.value).toEqual({ priced: 2, cents: 19500, atLeast: false });
    });

    it("all priced", async () => {
      const s = await service(14000);
      for (const ago of ["1 day", "2 days", "3 days"]) await appt(await call({ ago, outcome: "booked" }), s);
      const w = await getAfterHoursWeek(A);
      expect(w?.booked).toBe(3);
      expect(w?.value).toEqual({ priced: 3, cents: 42000, atLeast: false });
    });

    it("none priced: zero, never a guessed price", async () => {
      const s = await service(null);
      await appt(await call({ ago: "1 day", outcome: "booked" }), s);
      await appt(await call({ ago: "2 days", outcome: "faq_answered" }), null);
      const w = await getAfterHoursWeek(A);
      expect(w?.booked).toBe(2);
      expect(w?.value).toEqual({ priced: 0, cents: 0, atLeast: false });
    });

    it("a call with one priced and one unpriced appointment isn't counted", async () => {
      const c = await call({ ago: "1 day", outcome: "booked" });
      await appt(c, await service(10000));
      await appt(c, await service(null));
      expect((await getAfterHoursWeek(A))?.value).toEqual({ priced: 0, cents: 0, atLeast: false });
    });

    it("ignores another business's service and flags 'from' / range prices", async () => {
      await appt(await call({ ago: "1 day", outcome: "booked" }), await service(99900, { client: B }));
      await appt(await call({ ago: "1 day", outcome: "booked" }), await service(20000, { from: true }));
      await appt(await call({ ago: "2 days", outcome: "booked" }), await service(5000, { max: 9000 }));
      expect((await getAfterHoursWeek(A))?.value).toEqual({ priced: 2, cents: 25000, atLeast: true });
    });
  });
});
