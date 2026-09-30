import { describe, expect, it, vi } from "vitest";

/**
 * Signup's setup form: a validation error must hand back what the owner typed
 * (React 19 resets the form after an action), and must not create anything.
 */
const createClient = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`redirect:${u}`); } }));
vi.mock("@/lib/auth-guard", () => ({
  requireBusinessCreator: async () => ({ id: "u1", orgId: "org1", role: "client_admin", clientId: null }),
  requireOperator: vi.fn(),
  attachCreatorToClient: vi.fn(async () => true),
}));
vi.mock("@/lib/data/clients", () => ({ createClient: (...a: unknown[]) => createClient(...a) }));
vi.mock("@/lib/onboarding-apply", () => ({ applyWebsiteToClient: vi.fn() }));
vi.mock("@/lib/signup", () => ({ finishSignup: vi.fn() }));

const { onboardFromWebsitePortalAction } = await import("./onboard");

describe("onboardFromWebsitePortalAction", () => {
  it("returns the typed values with the field error, and creates nothing", async () => {
    const fd = new FormData();
    fd.set("name", "harbor view plumbing");
    fd.set("websiteUrl", "not a url!!");
    fd.set("industry", "plumber");
    fd.set("companySize", "team");
    const r = await onboardFromWebsitePortalAction({}, fd);
    expect(r.ok).toBe(false);
    expect(r.fieldErrors?.websiteUrl?.[0]).toMatch(/yourbusiness\.com/);
    expect((r.data as { values: Record<string, string> }).values).toEqual({
      name: "harbor view plumbing",
      websiteUrl: "not a url!!",
      industry: "plumber",
      companySize: "team",
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});
