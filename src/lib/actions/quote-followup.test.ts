import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  role: "client_admin",
  before: { enabled: false } as { enabled: boolean; enabledAt?: string },
  save: vi.fn(async (..._a: unknown[]) => undefined),
  audit: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ audit: (...a: unknown[]) => m.audit(...a) }));
vi.mock("@/lib/auth-guard", () => ({
  assertClientAccess: async () => ({ id: "u1", role: m.role, orgId: "o1" }),
}));
vi.mock("@/lib/data/clients", () => ({ assertClientInOrg: async () => undefined }));
vi.mock("@/lib/revenue/quote-followup-data", () => ({
  getSettings: async () => m.before,
  saveSettings: (...a: unknown[]) => m.save(...a),
}));

import { saveQuoteFollowupAction } from "./quote-followup";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  f.set("clientId", "c1");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  m.role = "client_admin";
  m.before = { enabled: false };
  m.save.mockClear();
});

describe("saveQuoteFollowupAction", () => {
  it("only the account admin or an operator can change it", async () => {
    m.role = "client_viewer";
    const r = await saveQuoteFollowupAction({}, form({ enabled: "on" }));
    expect(r.ok).toBe(false);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("an unchecked switch saves OFF (the default)", async () => {
    const r = await saveQuoteFollowupAction({}, form({}));
    expect(r.ok).toBe(true);
    expect(m.save).toHaveBeenCalledWith("c1", expect.objectContaining({ enabled: false }));
  });

  it("an operator can turn it on, and the turn-on time is recorded", async () => {
    m.role = "operator";
    await saveQuoteFollowupAction({}, form({ enabled: "on" }));
    const saved = m.save.mock.calls[0][1] as { enabled: boolean; enabledAt?: string };
    expect(saved.enabled).toBe(true);
    expect(saved.enabledAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "settings.quote_followup" }));
  });

  it("keeps the original turn-on time when saving edits while already on", async () => {
    m.before = { enabled: true, enabledAt: "2026-10-01T00:00:00.000Z" };
    await saveQuoteFollowupAction({}, form({ enabled: "on", step1Template: "Hi {name}" }));
    expect(m.save).toHaveBeenCalledWith("c1", expect.objectContaining({ enabledAt: "2026-10-01T00:00:00.000Z", step1Template: "Hi {name}" }));
  });

  it("rejects links and over-long wording without saving", async () => {
    const link = await saveQuoteFollowupAction({}, form({ enabled: "on", step1Template: "Deal at https://x.co" }));
    expect(link.ok).toBe(false);
    const long = await saveQuoteFollowupAction({}, form({ enabled: "on", step2Template: "x".repeat(400) }));
    expect(long.ok).toBe(false);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("empty boxes save no custom wording (back to the standard texts)", async () => {
    await saveQuoteFollowupAction({}, form({ enabled: "on", step1Template: "  ", step2Template: "" }));
    expect(m.save).toHaveBeenCalledWith("c1", expect.objectContaining({ step1Template: undefined, step2Template: undefined }));
  });
});
