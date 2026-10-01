import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Customer language memory against a real in-process Postgres (PGlite) with the full schema. */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
const warn = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));

const pg = ((await import("@/db")) as unknown as { __pg: import("@electric-sql/pglite").PGlite }).__pg;
const { rememberCustomerLanguage, getCustomerLanguage } = await import("./customer-languages");

const MIGRATION = readFileSync(path.resolve(__dirname, "../../../drizzle/manual/0011_customer_languages.sql"), "utf8");
const ORG = "00000000-0000-4000-8000-000000000001";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(async () => {
  await pg.exec(`DELETE FROM customer_languages; DELETE FROM clients; DELETE FROM organizations;`);
  await pg.query(`INSERT INTO organizations (id, name) VALUES ($1, 'Agency')`, [ORG]);
  await pg.query(`INSERT INTO clients (id, org_id, name) VALUES ($1, $3, 'A'), ($2, $3, 'B')`, [A, B, ORG]);
  warn.mockClear();
});

describe("migration 0011", () => {
  it("applies to a pre-feature database and is safe to run twice", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const fresh = new PGlite();
    await fresh.exec(`CREATE TABLE clients (id uuid PRIMARY KEY);`);
    await fresh.exec(MIGRATION);
    await fresh.exec(MIGRATION);
    const t = await fresh.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_languages'`);
    expect(t.rows).toHaveLength(1);
  });
  it("is a no-op on a database that already matches the Drizzle schema", async () => {
    await expect(pg.exec(MIGRATION)).resolves.toBeDefined();
  });
});

describe("customer languages", () => {
  it("remembers per business and phone, whatever the formatting; latest wins", async () => {
    await rememberCustomerLanguage({ clientId: A, phone: "+1 (415) 555-0100", language: "Spanish" });
    expect(await getCustomerLanguage(A, "4155550100")).toBe("es");
    expect(await getCustomerLanguage(B, "4155550100")).toBeNull();
    await rememberCustomerLanguage({ clientId: A, phone: "4155550100", language: "en" });
    expect(await getCustomerLanguage(A, "+14155550100")).toBe("en");
    const rows = await pg.query(`SELECT 1 FROM customer_languages`);
    expect(rows.rows).toHaveLength(1);
  });

  it("ignores unsupported languages and missing phones", async () => {
    await rememberCustomerLanguage({ clientId: A, phone: "4155550100", language: "Klingon" });
    await rememberCustomerLanguage({ clientId: A, phone: null, language: "es" });
    expect((await pg.query(`SELECT 1 FROM customer_languages`)).rows).toHaveLength(0);
    expect(await getCustomerLanguage(A, null)).toBeNull();
  });

  it("fails soft when the table isn't there yet (code deployed before the migration)", async () => {
    await pg.exec(`ALTER TABLE customer_languages RENAME TO customer_languages_tmp;`);
    try {
      await expect(rememberCustomerLanguage({ clientId: A, phone: "4155550100", language: "es" })).resolves.toBeUndefined();
      expect(await getCustomerLanguage(A, "4155550100")).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      await pg.exec(`ALTER TABLE customer_languages_tmp RENAME TO customer_languages;`);
    }
  });
});
