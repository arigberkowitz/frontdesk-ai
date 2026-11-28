import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The win-back sweep against a real in-process Postgres (PGlite) with the
 * full schema. Twilio is mocked (no live sends); the mock writes the same
 * sms_messages row the real notifier does, so dedupe is exercised for real.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const envMock = { SMS_ENABLED: true };
vi.mock("@/lib/env", () => ({ env: envMock, integrations: {} }));

const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const sent: { to: string; body: string; kind: string }[] = [];
const providerDown = { current: false };
vi.mock("@/lib/notifier", () => ({
  notifier: {
    sendSms: vi.fn(async (m: { to: string; body: string; log: { clientId: string; kind: string } }) => {
      if (providerDown.current) return { ok: false, skipped: true };
      sent.push({ to: m.to, body: m.body, kind: m.log.kind });
      const digits = m.to.replace(/\D/g, "");
      await pg.query(
        `INSERT INTO sms_messages (client_id, direction, customer_phone, body, status, kind) VALUES ($1, 'outbound', $2, $3, 'sent', $4)`,
        [m.log.clientId, digits.length === 10 ? `1${digits}` : digits, m.body, m.log.kind],
      );
      return { ok: true, id: `SM${sent.length}` };
    }),
  },
}));

const { runWinback } = await import("./winback");

const ORG = "00000000-0000-4000-8000-000000000001";
const PRO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STARTER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-11-20T19:00:00Z"); // 11 AM Pacific
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

const DUE = "+14155550101"; // 7 months ago, consented → texted
const SPANISH = "+14155550102"; // due, Spanish speaker → Spanish text
const RECENT = "+14155550103"; // 2 months ago → not due
const UPCOMING = "+14155550104"; // due, but booked next week → skipped
const NO_CONSENT = "+14155550105"; // due, never said yes to texts → skipped
const STOPPED = "+14155550106"; // due, replied STOP → skipped
const BLOCKED = "+14155550107"; // due, owner blocked → skipped
const SPAM = "+14155550108"; // due, call log says spam → skipped

async function appt(clientId: string, phone: string, startAt: string, name = "Pat Doe", status = "booked") {
  await pg.query(
    `INSERT INTO appointments (client_id, customer_name, customer_phone, start_at, status, service_id)
     VALUES ($1, $2, $3, $4, $5, (SELECT id FROM services WHERE client_id = $1 LIMIT 1))`,
    [clientId, name, phone, startAt, status],
  );
}

beforeAll(async () => {
  await pg.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Agency')`, [ORG]);
});

beforeEach(async () => {
  sent.length = 0;
  providerDown.current = false;
  envMock.SMS_ENABLED = true;
  await pg.exec(`DELETE FROM sms_messages; DELETE FROM appointments; DELETE FROM sms_consents; DELETE FROM sms_opt_outs;
    DELETE FROM customer_languages; DELETE FROM calls; DELETE FROM services; DELETE FROM subscriptions; DELETE FROM clients;`);
  const flags = (on: boolean) => JSON.stringify({ winback: { enabled: on, months: 6 }, blockedNumbers: ["4155550107"] });
  await pg.query(
    `INSERT INTO clients (id, org_id, name, status, timezone, setup_flags) VALUES
      ($1, $3, 'Bright Smile Dental', 'live', 'America/Los_Angeles', $4::jsonb),
      ($2, $3, 'Starter Plumbing', 'live', 'America/Los_Angeles', $4::jsonb)`,
    [PRO, STARTER, ORG, flags(true)],
  );
  await pg.query(`INSERT INTO subscriptions (client_id, plan, status) VALUES ($1, 'pro', 'active'), ($2, 'starter', 'active')`, [PRO, STARTER]);
  await pg.query(`INSERT INTO services (client_id, name) VALUES ($1, 'Teeth Cleaning'), ($2, 'Drain Clearing')`, [PRO, STARTER]);
  for (const phone of [DUE, SPANISH, UPCOMING, NO_CONSENT, STOPPED, BLOCKED, SPAM]) await appt(PRO, phone, daysAgo(210));
  await appt(PRO, RECENT, daysAgo(60));
  await appt(PRO, UPCOMING, daysAhead(7));
  await appt(STARTER, DUE, daysAgo(210));
  for (const phone of [DUE, SPANISH, RECENT, UPCOMING, STOPPED, BLOCKED, SPAM]) {
    await pg.query(`INSERT INTO sms_consents (client_id, phone, wording) VALUES ($1, $2, 'followup-v1'), ($3, $2, 'followup-v1')`, [PRO, phone, STARTER]);
  }
  // Agreed to booking texts only: win-back needs the separate follow-up yes.
  await pg.query(`INSERT INTO sms_consents (client_id, phone, wording) VALUES ($1, $2, 'booking-v2')`, [PRO, NO_CONSENT]);
  await pg.query(`INSERT INTO sms_opt_outs (phone) VALUES ('14155550106')`);
  await pg.query(`INSERT INTO customer_languages (client_id, phone, language) VALUES ($1, '14155550102', 'es')`, [PRO]);
  await pg.query(`INSERT INTO calls (client_id, from_number, outcome) VALUES ($1, $2, 'spam')`, [PRO, SPAM]);
});

describe("win-back sweep", () => {
  it("texts only due, consented, reachable customers of Pro businesses", async () => {
    const results = await runWinback(60_000, NOW);
    expect(sent.map((s) => s.to).sort()).toEqual([DUE, SPANISH].sort());
    expect(sent.every((s) => s.kind === "winback")).toBe(true);
    // Starter is gated out on the server even with the switch on.
    expect(results.map((r) => r.clientId)).toEqual([PRO]);
    const en = sent.find((s) => s.to === DUE)!.body;
    expect(en).toContain("Bright Smile Dental");
    expect(en).toContain("your teeth cleaning");
    expect(en).toMatch(/Reply STOP to opt out\.$/);
    expect(sent.find((s) => s.to === SPANISH)!.body).toMatch(/^Hola .*Responda STOP/);
  });

  it("does one pass a month, and never texts the same customer twice in an interval", async () => {
    await runWinback(60_000, NOW);
    expect(sent).toHaveLength(2);
    const flags = await pg.query<{ f: { winback: { lastRunMonth: string } } }>(`SELECT setup_flags AS f FROM clients WHERE id = $1`, [PRO]);
    expect(flags.rows[0].f.winback.lastRunMonth).toBe("2026-11");
    await runWinback(60_000, new Date(NOW.getTime() + 86_400_000));
    expect(sent).toHaveLength(2);
    // Next month: the month gate opens, but the per-interval rule still holds.
    await runWinback(60_000, new Date("2026-12-15T19:00:00Z"));
    expect(sent).toHaveLength(2);
  });

  it("sends nothing outside 9 AM to 8 PM local", async () => {
    await runWinback(60_000, new Date("2026-11-20T15:00:00Z")); // 7 AM Pacific
    expect(sent).toHaveLength(0);
  });

  it("fails safe while texting isn't approved: nothing sent, month not marked done", async () => {
    envMock.SMS_ENABLED = false;
    const [r] = await runWinback(60_000, NOW);
    expect(r.skipped).toBe("texting_not_approved");
    expect(sent).toHaveLength(0);
    const flags = await pg.query<{ f: { winback: { lastRunMonth?: string } } }>(`SELECT setup_flags AS f FROM clients WHERE id = $1`, [PRO]);
    expect(flags.rows[0].f.winback.lastRunMonth).toBeUndefined();
  });

  it("stops at the first provider skip and tries again next run", async () => {
    providerDown.current = true;
    const [r] = await runWinback(60_000, NOW);
    expect(r.skipped).toBe("sms_not_configured");
    providerDown.current = false;
    await runWinback(60_000, NOW);
    expect(sent).toHaveLength(2);
  });

  it("does nothing when the owner left it off", async () => {
    await pg.query(`UPDATE clients SET setup_flags = '{"winback":{"enabled":false}}'::jsonb`);
    expect(await runWinback(60_000, NOW)).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
