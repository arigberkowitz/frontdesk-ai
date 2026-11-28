import { beforeEach, describe, expect, it, vi } from "vitest";

/** The plan gate lives on the server: a Starter business can't switch win-back on by posting the form. */

const updates: unknown[] = [];
vi.mock("@/db", () => ({
  db: { update: vi.fn(() => ({ set: vi.fn((v: unknown) => ({ where: vi.fn(async () => updates.push(v)) })) })) },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth-guard", () => ({ assertClientAccess: vi.fn(async () => ({ id: "u1", role: "client_admin", orgId: "o1" })) }));
vi.mock("@/lib/data/clients", () => ({ assertClientInOrg: vi.fn(async () => ({ id: "c1", status: "live", setupFlags: {} })) }));
const pro = { current: false };
vi.mock("@/lib/plan-access", async (orig) => ({
  ...(await orig<typeof import("@/lib/plan-access")>()),
  planAccessFor: vi.fn(async () => ({ has: () => pro.current, features: new Set(), plan: pro.current ? "pro" : "starter" })),
}));

const { saveWinbackSettingsAction } = await import("./revenue-settings");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ clientId: "c1", months: "6", ...fields })) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  updates.length = 0;
  pro.current = false;
});

describe("saveWinbackSettingsAction", () => {
  it("refuses to switch win-back on below Pro, and writes nothing", async () => {
    const r = await saveWinbackSettingsAction({}, form({ enabled: "on" }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Pro feature/);
    expect(updates).toHaveLength(0);
  });
  it("always lets an owner switch it off", async () => {
    const r = await saveWinbackSettingsAction({}, form({}));
    expect(r.ok).toBe(true);
    expect(updates).toHaveLength(1);
  });
  it("saves on Pro, and rejects a template with a link", async () => {
    pro.current = true;
    expect((await saveWinbackSettingsAction({}, form({ enabled: "on", months: "12" }))).message).toMatch(/12 months/);
    const bad = await saveWinbackSettingsAction({}, form({ enabled: "on", template: "see www.x.com" }));
    expect(bad.fieldErrors?.template?.[0]).toMatch(/links/i);
  });
});
