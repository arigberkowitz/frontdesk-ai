import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: "client_admin",
  env: { MISSED_CALL_AI_CALLBACKS: false },
  set: vi.fn((..._a: unknown[]) => ({ where: async () => undefined })),
  audit: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({ db: { update: () => ({ set: (...a: unknown[]) => m.set(...a) }) } }));
vi.mock("@/lib/data/audit", () => ({ audit: (...a: unknown[]) => m.audit(...a) }));
vi.mock("@/lib/auth-guard", () => ({
  assertClientAccess: async () => ({ id: "u1", role: m.role, orgId: "o1" }),
}));
vi.mock("@/lib/data/clients", () => ({ assertClientInOrg: async () => undefined }));
vi.mock("@/lib/env", () => ({ env: m.env }));

import { saveMissedCallSettingsAction } from "./missed-call-settings";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  f.set("clientId", "c1");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  m.role = "client_admin";
  m.env.MISSED_CALL_AI_CALLBACKS = false;
  m.set.mockClear();
});

describe("saveMissedCallSettingsAction", () => {
  it("only the account admin can change it", async () => {
    m.role = "client_viewer";
    const r = await saveMissedCallSettingsAction({ ok: false }, form({ enabled: "on" }));
    expect(r.ok).toBe(false);
    expect(m.set).not.toHaveBeenCalled();
  });

  it("an unchecked switch saves OFF", async () => {
    await saveMissedCallSettingsAction({ ok: false }, form({}));
    expect(m.set).toHaveBeenCalledWith({ missedCallTextsEnabled: false, missedCallAiCallbacksEnabled: false });
  });

  it("never saves AI callbacks on without the platform env var", async () => {
    await saveMissedCallSettingsAction({ ok: false }, form({ enabled: "on", aiCallbacks: "on" }));
    expect(m.set).toHaveBeenCalledWith({ missedCallTextsEnabled: true, missedCallAiCallbacksEnabled: false });
  });

  it("AI callbacks need texts on too, and the env var", async () => {
    m.env.MISSED_CALL_AI_CALLBACKS = true;
    await saveMissedCallSettingsAction({ ok: false }, form({ aiCallbacks: "on" }));
    expect(m.set).toHaveBeenLastCalledWith({ missedCallTextsEnabled: false, missedCallAiCallbacksEnabled: false });
    await saveMissedCallSettingsAction({ ok: false }, form({ enabled: "on", aiCallbacks: "on" }));
    expect(m.set).toHaveBeenLastCalledWith({ missedCallTextsEnabled: true, missedCallAiCallbacksEnabled: true });
  });
});
