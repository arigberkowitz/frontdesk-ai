import { beforeEach, describe, expect, it, vi } from "vitest";

/** "Let through": adds to the allow list, takes the number off the block list, owner/editor only. */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/agent-publish", () => ({ applyClientEdit: vi.fn(), withSyncNote: (m: string) => m }));
let allowed = true;
vi.mock("@/lib/auth-guard", () => ({
  requireClientEditor: async () => (allowed ? { ok: true, user: { id: "u1", orgId: "o1" } } : { ok: false, error: "No access." }),
}));
vi.mock("@/lib/data/clients", () => ({ assertClientInOrg: async () => {} }));

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { allowNumberAction } = await import("./spam");

let clientId = "";
const form = (phone: string) => {
  const f = new FormData();
  f.set("clientId", clientId);
  f.set("phone", phone);
  return f;
};

beforeEach(async () => {
  allowed = true;
  await db.delete(schema.clients);
  const [org] = await db.insert(schema.organizations).values({ name: "House", kind: "agency" }).returning();
  const [c] = await db
    .insert(schema.clients)
    .values({ orgId: org!.id, name: "Mission Plumbing", status: "live", setupFlags: { blockedNumbers: ["4155550199"], featuresReviewed: true } })
    .returning();
  clientId = c!.id;
});

describe("allowNumberAction", () => {
  it("lets the number through and unblocks it, keeping other settings", async () => {
    const r = await allowNumberAction({ ok: false }, form("+1 (415) 555-0199"));
    expect(r).toMatchObject({ ok: true, message: "(415) 555-0199 will be answered from now on." });
    const c = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
    expect(c?.setupFlags).toEqual({ blockedNumbers: [], allowedNumbers: ["4155550199"], featuresReviewed: true });
  });
  it("refuses junk and people without edit access", async () => {
    expect((await allowNumberAction({ ok: false }, form("12"))).ok).toBe(false);
    allowed = false;
    expect((await allowNumberAction({ ok: false }, form("+14155550199"))).ok).toBe(false);
  });
});
