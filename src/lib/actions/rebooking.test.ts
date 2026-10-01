import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: "client_admin",
  editorOk: true,
  set: vi.fn((..._a: unknown[]) => ({ where: async () => undefined })),
  send: vi.fn(async (..._a: unknown[]) => ({ sent: 2, skipped: { opted_out: 1 } }) as unknown),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({ db: { update: () => ({ set: (...a: unknown[]) => m.set(...a) }) } }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  assertClientAccess: async () => ({ id: "u1", role: m.role, orgId: "o1" }),
  requireClientEditor: async () =>
    m.editorOk ? { ok: true, user: { id: "u1", orgId: "o1" } } : { ok: false, error: "Editing is limited to your admin." },
}));
vi.mock("@/lib/data/clients", () => ({ assertClientInOrg: async () => undefined }));
vi.mock("@/lib/rebooking", () => ({ sendRebookOffers: (...a: unknown[]) => m.send(...a) }));

import { saveSmartRebookingSettingsAction, sendRebookOffersAction } from "./rebooking";

const ID = "11111111-1111-4111-8111-111111111111";
function form(fields: [string, string][]): FormData {
  const f = new FormData();
  f.set("clientId", "c1");
  for (const [k, v] of fields) f.append(k, v);
  return f;
}

beforeEach(() => {
  m.role = "client_admin";
  m.editorOk = true;
  m.set.mockClear();
  m.send.mockClear();
});

describe("saveSmartRebookingSettingsAction", () => {
  it("admin only", async () => {
    m.role = "client_viewer";
    expect((await saveSmartRebookingSettingsAction({}, form([["enabled", "on"]]))).ok).toBe(false);
    expect(m.set).not.toHaveBeenCalled();
  });
  it("an unchecked switch saves off", async () => {
    await saveSmartRebookingSettingsAction({}, form([]));
    expect(m.set).toHaveBeenCalledWith({ smartRebookingEnabled: false });
  });
});

describe("sendRebookOffersAction", () => {
  it("never sends without the explicit confirmation", async () => {
    const r = await sendRebookOffersAction({}, form([["appointmentId", ID]]));
    expect(r.ok).toBe(false);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("sends on confirmation and reports who wasn't texted", async () => {
    const r = await sendRebookOffersAction({}, form([["appointmentId", ID], ["confirm", "yes"]]));
    expect(m.send).toHaveBeenCalledWith("c1", [ID], "u1");
    expect(r).toEqual({ ok: true, message: "Texted 2 customers new times. Not texted: 1 opted out — call those ones." });
  });

  it("ignores junk ids and requires an editor", async () => {
    expect((await sendRebookOffersAction({}, form([["appointmentId", "x' or 1=1"], ["confirm", "yes"]]))).ok).toBe(false);
    m.editorOk = false;
    expect((await sendRebookOffersAction({}, form([["appointmentId", ID], ["confirm", "yes"]]))).ok).toBe(false);
    expect(m.send).not.toHaveBeenCalled();
  });

  it("surfaces the feature-off refusal", async () => {
    m.send.mockResolvedValueOnce({ error: "Turn on rebooking texts in Settings → Follow-ups first." });
    const r = await sendRebookOffersAction({}, form([["appointmentId", ID], ["confirm", "yes"]]));
    expect(r).toEqual({ ok: false, error: "Turn on rebooking texts in Settings → Follow-ups first." });
  });
});
