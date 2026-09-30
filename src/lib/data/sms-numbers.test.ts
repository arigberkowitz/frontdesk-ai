import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-business texting numbers against a real in-process Postgres (PGlite)
 * with the full schema: number lookup, the one-live-business-per-number rule,
 * opt-out scoping (shared vs a business's own number), reply routing on the
 * shared number, and the hand-written migration being safe to run twice.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const numbers = await import("./sms-numbers");
const optouts = await import("./sms-optouts");
const inbox = await import("./sms-messages");

const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../../drizzle/manual/0009_client_sms_numbers.sql"),
  "utf8",
);

const ORG = "00000000-0000-4000-8000-000000000001";
const DENTIST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLUMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CUSTOMER = "+14155550100";

beforeAll(async () => {
  await pg.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Agency')`, [ORG]);
  await pg.query(
    `INSERT INTO clients (id, org_id, name, sms_number) VALUES ($1, $2, 'Dentist', '+14155559999'), ($3, $2, 'Plumber', NULL)`,
    [DENTIST, ORG, PLUMBER],
  );
});

beforeEach(async () => {
  await pg.exec(`DELETE FROM sms_opt_outs; DELETE FROM client_sms_opt_outs; DELETE FROM sms_messages;`);
});

describe("migration 0009", () => {
  it("applies to a pre-feature database and is safe to run twice", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const fresh = new PGlite();
    await fresh.exec(`CREATE TABLE clients (id uuid PRIMARY KEY, deleted_at timestamptz);`);
    await fresh.exec(MIGRATION);
    await fresh.exec(MIGRATION);
    const cols = await fresh.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'clients'`,
    );
    expect(cols.rows.map((r) => r.column_name)).toContain("sms_number");
    const t = await fresh.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'client_sms_opt_outs'`);
    expect(t.rows).toHaveLength(1);
  });

  it("is a no-op on a database that already matches the Drizzle schema", async () => {
    await expect(pg.exec(MIGRATION)).resolves.toBeDefined();
  });
});

describe("texting number lookup", () => {
  it("finds the business by its own number in any format", async () => {
    for (const raw of ["+14155559999", "(415) 555-9999", "14155559999", "415.555.9999"]) {
      expect((await numbers.findClientBySmsNumber(raw))?.id).toBe(DENTIST);
    }
  });

  it("returns null for the shared number / unknown numbers / junk", async () => {
    expect(await numbers.findClientBySmsNumber("+18885550000")).toBeNull();
    expect(await numbers.findClientBySmsNumber("")).toBeNull();
    expect(await numbers.findClientBySmsNumber("12345")).toBeNull();
  });

  it("getClientSmsNumber: own number, or null (→ shared)", async () => {
    expect(await numbers.getClientSmsNumber(DENTIST)).toBe("+14155559999");
    expect(await numbers.getClientSmsNumber(PLUMBER)).toBeNull();
  });

  it("one live business per number; a soft-deleted business frees it", async () => {
    await expect(
      pg.query(`UPDATE clients SET sms_number = '+14155559999' WHERE id = $1`, [PLUMBER]),
    ).rejects.toThrow();
    expect(await numbers.findOtherClientWithSmsNumber("+14155559999", PLUMBER)).toMatchObject({
      id: DENTIST,
    });

    const GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await pg.query(
      `INSERT INTO clients (id, org_id, name, sms_number, deleted_at) VALUES ($1, $2, 'Gone', '+14155558888', now())`,
      [GONE, ORG],
    );
    expect(await numbers.findClientBySmsNumber("+14155558888")).toBeNull();
    await numbers.setClientSmsNumber(ORG, PLUMBER, "+14155558888");
    expect(await numbers.getClientSmsNumber(PLUMBER)).toBe("+14155558888");
    await numbers.setClientSmsNumber(ORG, PLUMBER, null);
  });

  it("setClientSmsNumber is scoped to the org", async () => {
    await numbers.setClientSmsNumber("00000000-0000-4000-8000-000000000999", PLUMBER, "+14155557777");
    expect(await numbers.getClientSmsNumber(PLUMBER)).toBeNull();
  });
});

describe("STOP scoping", () => {
  it("STOP to the shared number blocks every business", async () => {
    await optouts.recordOptOut(CUSTOMER, "stop");
    expect(await optouts.isOptedOut(CUSTOMER, DENTIST)).toBe(true);
    expect(await optouts.isOptedOut(CUSTOMER, PLUMBER)).toBe(true);
    expect(await optouts.isOptedOut(CUSTOMER)).toBe(true);
  });

  it("STOP to a business's own number blocks that business, not others", async () => {
    await optouts.recordOptOut(CUSTOMER, "stop", { clientId: DENTIST, businessPhone: "+14155559999" });
    expect(await optouts.isOptedOut(CUSTOMER, DENTIST)).toBe(true);
    expect(await optouts.isOptedOut("(415) 555-0100", DENTIST)).toBe(true);
    expect(await optouts.isOptedOut(CUSTOMER, PLUMBER)).toBe(false);
    // A caller that doesn't say which business is sending gets the safe answer.
    expect(await optouts.isOptedOut(CUSTOMER)).toBe(true);
    const row = await pg.query(`SELECT phone, business_phone FROM client_sms_opt_outs`);
    expect(row.rows).toEqual([{ phone: "14155550100", business_phone: "14155559999" }]);
  });

  it("a repeated STOP is stored once (webhook replays)", async () => {
    const scope = { clientId: DENTIST, businessPhone: "+14155559999" };
    await optouts.recordOptOut(CUSTOMER, "stop", scope);
    await optouts.recordOptOut(CUSTOMER, "unsubscribe", scope);
    await optouts.recordOptOut(CUSTOMER, "stop");
    await optouts.recordOptOut(CUSTOMER, "stop");
    expect((await pg.query(`SELECT 1 FROM client_sms_opt_outs`)).rows).toHaveLength(1);
    expect((await pg.query(`SELECT 1 FROM sms_opt_outs`)).rows).toHaveLength(1);
  });

  it("START to a business's own number lifts only that business's STOP", async () => {
    await optouts.recordOptOut(CUSTOMER, "stop");
    await optouts.recordOptOut(CUSTOMER, "stop", { clientId: DENTIST });
    await optouts.removeOptOut(CUSTOMER, { clientId: DENTIST });
    // The shared-number STOP still stands — and still blocks the dentist too.
    expect(await optouts.isOptedOut(CUSTOMER, DENTIST)).toBe(true);
    await optouts.removeOptOut(CUSTOMER);
    expect(await optouts.isOptedOut(CUSTOMER, DENTIST)).toBe(false);
  });

  it("START to the shared number doesn't undo a STOP sent to a business's own number", async () => {
    await optouts.recordOptOut(CUSTOMER, "stop", { clientId: DENTIST });
    await optouts.removeOptOut(CUSTOMER);
    expect(await optouts.isOptedOut(CUSTOMER, DENTIST)).toBe(true);
    expect(await optouts.isOptedOut(CUSTOMER, PLUMBER)).toBe(false);
  });

  it("a business-level STOP survives the business losing its own number", async () => {
    await optouts.recordOptOut(CUSTOMER, "stop", { clientId: DENTIST });
    await numbers.setClientSmsNumber(ORG, DENTIST, null);
    // It would now text from the shared number — still blocked.
    expect(await optouts.isOptedOut(CUSTOMER, DENTIST)).toBe(true);
    await numbers.setClientSmsNumber(ORG, DENTIST, "+14155559999");
  });
});

describe("reply routing on the shared number", () => {
  async function sent(clientId: string, from: string | null) {
    await inbox.recordOutboundSms(
      { clientId, kind: "appointment_reminder" },
      { to: CUSTOMER, from, body: "hi", ok: true, providerSid: `SM_${Math.random()}` },
    );
  }

  it("ignores texts a business sent from its own number", async () => {
    await sent(PLUMBER, "+18885550000"); // shared, earlier
    await new Promise((r) => setTimeout(r, 5));
    await sent(DENTIST, "+14155559999"); // dentist's own number, latest
    expect(await inbox.findClientLastMessaged(CUSTOMER, "+18885550000")).toBe(PLUMBER);
    // Without a number (legacy callers) it's still simply the latest.
    expect(await inbox.findClientLastMessaged(CUSTOMER)).toBe(DENTIST);
  });

  it("still counts old rows that recorded no sending number", async () => {
    await sent(PLUMBER, null);
    expect(await inbox.findClientLastMessaged(CUSTOMER, "+18885550000")).toBe(PLUMBER);
  });
});
