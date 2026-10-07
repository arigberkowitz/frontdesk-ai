import { beforeEach, describe, expect, it, vi } from "vitest";

/** Opening a setup link: works until the owner signs in, then sends you to sign in. */

const signedIn = new Set<string>();
vi.mock("@/lib/intake-token", () => ({
  verifyIntakeToken: (t: string) => (t.startsWith("ok-") ? t.slice(3) : null),
  INTAKE_USED_SIGN_IN: "/sign-in?reason=setup-link-used",
}));
vi.mock("@/lib/data/clients", () => ({
  getClientByIdUnsafe: async (id: string) => ({ id, name: "Harbor View", websiteUrl: null }),
}));
vi.mock("@/lib/data/intake", () => ({ ownerHasSignedIn: async (id: string) => signedIn.has(id) }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error(`redirect:${u}`);
  },
}));
vi.mock("@/components/intake/intake-form", () => ({ IntakeForm: () => null }));

const { default: IntakePage } = await import("./page");
const open = (token: string) => IntakePage({ params: Promise.resolve({ token }) });

beforeEach(() => signedIn.clear());

describe("intake page", () => {
  it("shows the form for a valid link before the owner has signed in", async () => {
    await expect(open("ok-c1")).resolves.toBeTruthy();
  });

  it("redirects a reused link to sign-in once the owner has signed in", async () => {
    signedIn.add("c1");
    await expect(open("ok-c1")).rejects.toThrow("redirect:/sign-in?reason=setup-link-used");
  });

  it("an expired link still shows 'Link expired' (no redirect, no form)", async () => {
    const el = (await open("expired")) as { props: { children: unknown } };
    expect(JSON.stringify(el.props.children, (_k, v) => (typeof v === "function" ? undefined : v))).toContain(
      "Link expired",
    );
  });
});
