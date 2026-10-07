import { beforeEach, describe, expect, it, vi } from "vitest";

/** The trial summary is built from real rows — and only the right ones. */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { getTrialProgress } = await import("./trial-progress");

const DAY = 86_400_000;
let n = 0;

async function seedClient(extra: Partial<typeof schema.clients.$inferInsert> = {}) {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({
      orgId: org!.id,
      name: "Nick's",
      timezone: "America/New_York",
      status: "trial",
      trialEndsAt: new Date(Date.now() + 9 * DAY),
      createdAt: new Date(Date.now() - 30 * DAY),
      ...extra,
    })
    .returning();
  return c!;
}

async function call(clientId: string, daysAgo: number, extra: Partial<typeof schema.calls.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.calls)
    .values({ clientId, retellCallId: `c${n++}`, startAt: new Date(Date.now() - daysAgo * DAY), ...extra })
    .returning();
  return row!;
}

async function appt(clientId: string, extra: Partial<typeof schema.appointments.$inferInsert> = {}) {
  await db.insert(schema.appointments).values({ clientId, startAt: new Date(Date.now() + DAY), ...extra });
}

beforeEach(async () => {
  await db.delete(schema.appointments);
  await db.delete(schema.calls);
  await db.delete(schema.clients);
  await db.delete(schema.organizations);
});

describe("getTrialProgress", () => {
  it("is null without a trial clock", async () => {
    const c = await seedClient({ trialEndsAt: null, status: "live" });
    expect(await getTrialProgress(c.id)).toBeNull();
  });

  it("counts calls since the trial started, minus spam and anything before it", async () => {
    const c = await seedClient(); // 14-day trial, 5 days in
    await call(c.id, 1, { isAfterHours: true });
    await call(c.id, 2);
    await call(c.id, 3, { outcome: "booked" });
    await call(c.id, 2, { outcome: "spam" }); // not "handled"
    await call(c.id, 10); // before the trial began
    const p = await getTrialProgress(c.id);
    expect(p).toMatchObject({ calls: 3, afterHours: 1 });
  });

  it("counts appointments the AI booked on a call — not hand-entered, cancelled or no-shows", async () => {
    const c = await seedClient();
    const k = await call(c.id, 1);
    await appt(c.id, { callId: k.id });
    await appt(c.id, { callId: k.id, status: "confirmed" });
    await appt(c.id, { callId: k.id, status: "cancelled" });
    await appt(c.id, { callId: k.id, status: "no_show" });
    await appt(c.id, { callId: null }); // owner typed it in
    await appt(c.id, { callId: k.id, createdAt: new Date(Date.now() - 10 * DAY) }); // before the trial
    expect((await getTrialProgress(c.id))?.booked).toBe(2);
  });

  it("never counts another business's activity", async () => {
    const a = await seedClient();
    const b = await seedClient();
    const k = await call(b.id, 1);
    await appt(b.id, { callId: k.id });
    expect(await getTrialProgress(a.id)).toMatchObject({ calls: 0, booked: 0 });
  });
});
