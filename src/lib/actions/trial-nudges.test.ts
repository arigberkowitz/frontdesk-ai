import { beforeEach, describe, expect, it, vi } from "vitest";

/** Only the owner can opt in/out of the 3-day trial reminder; other flags survive. */

let owner = true;
vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireClientOwner: async () =>
    owner ? { ok: true, user: { id: "u1", orgId: "org", role: "client_admin" } } : { ok: false, error: "Only the owner can do that." },
}));
vi.mock("@/lib/data/clients", () => ({ assertClientInOrg: async () => {} }));

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { setTrialReminderAction } = await import("./trial-nudges");

async function client() {
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({ orgId: org!.id, name: "Biz", timezone: "America/New_York", setupFlags: { calendarSkipped: true } })
    .returning();
  return c!;
}
const form = (clientId: string, on: boolean) => {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("on", String(on));
  return fd;
};

beforeEach(() => {
  owner = true;
});

describe("setTrialReminderAction", () => {
  it("turns the reminder on and off, keeping other setup flags", async () => {
    const c = await client();
    expect((await setTrialReminderAction({}, form(c.id, true))).ok).toBe(true);
    let row = await db.query.clients.findFirst({ where: eq(schema.clients.id, c.id) });
    expect(row?.setupFlags).toMatchObject({ trialReminderOptIn: true, calendarSkipped: true });
    await setTrialReminderAction({}, form(c.id, false));
    row = await db.query.clients.findFirst({ where: eq(schema.clients.id, c.id) });
    expect(row?.setupFlags?.trialReminderOptIn).toBe(false);
  });

  it("refuses staff and changes nothing", async () => {
    const c = await client();
    owner = false;
    const r = await setTrialReminderAction({}, form(c.id, true));
    expect(r.ok).toBe(false);
    const row = await db.query.clients.findFirst({ where: eq(schema.clients.id, c.id) });
    expect(row?.setupFlags?.trialReminderOptIn).toBeUndefined();
  });
});
