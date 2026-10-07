import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Push subscriptions against a real in-process Postgres (PGlite) with the full
 * schema: per-owner scoping, endpoint uniqueness (a re-subscribe moves the
 * device), per-kind targeting, failure counting — and the hand-written
 * migration (0017) matches the Drizzle table and is safe to run twice.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const dbMod = (await import("@/db")) as unknown as {
  db: (typeof import("@/db"))["db"];
  __pg: { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>; exec: (sql: string) => Promise<unknown> };
};
const { db, __pg: pg } = dbMod;
const s = await import("@/db/schema");
const data = await import("./push-subscriptions");

let clientId: string;
let otherClientId: string;
let owner: string;
let coOwner: string;
const keys = { p256dh: "BNcR".padEnd(87, "x"), auth: "tBHI".padEnd(22, "y") };
const ep = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;

beforeAll(async () => {
  const [org] = await db.insert(s.organizations).values({ name: "Biz", kind: "business" }).returning();
  const [c] = await db.insert(s.clients).values({ orgId: org.id, name: "Bright" }).returning();
  const [o] = await db.insert(s.clients).values({ orgId: org.id, name: "Other" }).returning();
  clientId = c.id;
  otherClientId = o.id;
  const [u1] = await db.insert(s.users).values({ orgId: org.id, email: "a@x.co", role: "client_admin", clientId }).returning();
  const [u2] = await db.insert(s.users).values({ orgId: org.id, email: "b@x.co", role: "client_admin", clientId }).returning();
  owner = u1.id;
  coOwner = u2.id;
});

describe("push subscriptions data", () => {
  it("saves a device, and re-saving the same endpoint updates instead of duplicating", async () => {
    await data.upsertPushSubscription(clientId, owner, { endpoint: ep("phone"), ...keys, userAgent: "iPhone" });
    await data.markPushFailed((await data.listUserPushSubscriptions(clientId, owner))[0].id, "502");
    const again = await data.upsertPushSubscription(clientId, owner, { endpoint: ep("phone"), ...keys, userAgent: "iPhone 2" });
    const mine = await data.listUserPushSubscriptions(clientId, owner);
    expect(mine).toHaveLength(1);
    expect(again.userAgent).toBe("iPhone 2");
    expect(again.failureCount).toBe(0); // a fresh subscribe clears old failures
  });

  it("a device that another owner subscribes moves to them (never two businesses' alerts)", async () => {
    await data.upsertPushSubscription(clientId, owner, { endpoint: ep("shared"), ...keys });
    await data.upsertPushSubscription(otherClientId, coOwner, { endpoint: ep("shared"), ...keys });
    expect((await data.listUserPushSubscriptions(clientId, owner)).map((r) => r.endpoint)).not.toContain(ep("shared"));
    expect((await data.listClientPushTargets(otherClientId, "text")).map((r) => r.endpoint)).toEqual([ep("shared")]);
  });

  it("targets by kind and by business", async () => {
    await data.upsertPushSubscription(clientId, coOwner, { endpoint: ep("laptop"), ...keys });
    await data.updatePushPreferences(clientId, coOwner, ep("laptop"), { notifyTexts: false });
    const texts = (await data.listClientPushTargets(clientId, "text")).map((r) => r.endpoint).sort();
    const bookings = (await data.listClientPushTargets(clientId, "booking")).map((r) => r.endpoint).sort();
    expect(texts).toEqual([ep("phone")]);
    expect(bookings).toEqual([ep("laptop"), ep("phone")]);
  });

  it("an owner can only change or remove their own devices", async () => {
    expect(await data.updatePushPreferences(clientId, owner, ep("laptop"), { notifyBookings: false })).toBe(false);
    expect(await data.deletePushSubscription(clientId, owner, ep("laptop"))).toBe(false);
    expect(await data.deletePushSubscription(otherClientId, coOwner, ep("laptop"))).toBe(false);
    expect(await data.deletePushSubscription(clientId, coOwner, ep("laptop"))).toBe(true);
    expect(await data.listUserPushSubscriptions(clientId, coOwner)).toEqual([]);
  });

  it("counts failures and resets them on delivery", async () => {
    const [row] = await data.listUserPushSubscriptions(clientId, owner);
    expect(await data.markPushFailed(row.id, "timeout")).toBe(1);
    expect(await data.markPushFailed(row.id, "timeout")).toBe(2);
    await data.markPushDelivered(row.id);
    const [after] = await data.listUserPushSubscriptions(clientId, owner);
    expect(after.failureCount).toBe(0);
    expect(after.lastSuccessAt).toBeInstanceOf(Date);
    await data.deletePushSubscriptionById(row.id);
    expect(await data.listUserPushSubscriptions(clientId, owner)).toEqual([]);
  });
});

describe("drizzle/manual/0017_push_subscriptions.sql", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../drizzle/manual/0017_push_subscriptions.sql"), "utf8");
  const shape = async () =>
    (
      await pg.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
         where table_name = 'push_subscriptions' order by column_name`,
      )
    ).rows;
  const indexes = async () =>
    (await pg.query(`select indexname from pg_indexes where tablename = 'push_subscriptions' order by indexname`)).rows.map(
      (r) => r.indexname,
    );

  it("creates exactly the table Drizzle expects, and is safe to run twice", async () => {
    const expected = await shape();
    const expectedIdx = await indexes();
    await pg.exec(`drop table push_subscriptions`);
    await pg.exec(sql);
    await pg.exec(sql); // idempotent
    expect(await shape()).toEqual(expected);
    expect(await indexes()).toEqual(expectedIdx);
    const fks = (
      await pg.query(
        `select conname from pg_constraint where conrelid = 'push_subscriptions'::regclass and contype = 'f' order by conname`,
      )
    ).rows.map((r) => r.conname);
    expect(fks).toEqual(["push_subscriptions_client_id_clients_id_fk", "push_subscriptions_user_id_users_id_fk"]);
  });

  it("is additive only", () => {
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/\b(drop|truncate|delete\s+from|update\s+"?\w+"?\s+set|alter\s+column|rename)\b/i);
  });
});
