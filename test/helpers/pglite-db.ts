/**
 * An in-process Postgres (PGlite) with the FULL current Drizzle schema, for
 * tests that call data-layer functions selecting whole rows (e.g. every
 * `clients` column). The DDL is generated from src/db/schema.ts by
 * drizzle-kit, so it can't drift from what the code expects.
 *
 * Usage (inside a test file):
 *   vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
 */
export async function pgliteDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const api = await import("drizzle-kit/api");
  const schema = await import("@/db/schema");
  const pg = new PGlite();
  const ddl = await api.generateMigration(
    await api.generateDrizzleJson({}),
    await api.generateDrizzleJson(schema as unknown as Record<string, unknown>),
  );
  for (const stmt of ddl) await pg.exec(stmt);
  return { db: drizzle(pg, { schema }), __pg: pg };
}
