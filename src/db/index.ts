import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Drizzle client over postgres-js (standard TCP). Works with local Postgres in
 * dev and Neon in production — use Neon's pooled connection string; postgres-js
 * honors `?sslmode=require`. Unlike the Neon HTTP driver, this supports
 * multi-statement transactions, which Phase 1 booking relies on.
 *
 * The client + db are cached on globalThis so HMR doesn't open a new pool on
 * every reload. Server-only; import *types* from "@/db/schema" in shared code.
 */
type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __fdaiSql?: ReturnType<typeof postgres>;
  __fdaiDb?: Db;
};

function createClient(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a Postgres connection string to .env.local (see .env.example).",
    );
  }
  const isProd = process.env.NODE_ENV === "production";
  return postgres(url, {
    // On serverless (Vercel), each function instance keeps its own pool, so keep
    // it tiny to avoid exhausting the database's connection limit; dev can pool more.
    max: isProd ? 1 : 10,
    // Neon's pooled endpoint runs PgBouncer in transaction mode, which doesn't
    // support prepared statements — disable them so the pooled driver works.
    prepare: false,
    idle_timeout: 20,
  });
}

// Cache the pool + db on globalThis in every environment: dev avoids opening a
// new pool on each HMR reload, and serverless reuses the pool across warm
// invocations of the same function instance.
//
// Lazy: the pool is opened on first use, not on import, so `next build` can
// collect route config without DATABASE_URL. A missing URL still throws — at
// the first query instead of at module load.
function realDb(): Db {
  if (!globalForDb.__fdaiDb) {
    const client = globalForDb.__fdaiSql ?? createClient();
    globalForDb.__fdaiSql = client;
    globalForDb.__fdaiDb = drizzle(client, { schema });
  }
  return globalForDb.__fdaiDb;
}

export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    const target = realDb();
    const value = Reflect.get(target as object, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
  has(_t, prop) {
    return Reflect.has(realDb() as object, prop);
  },
});

export { schema };
export * from "./schema";
