import { afterEach, describe, expect, it, vi } from "vitest";

/** Calendar OAuth options are gated on env; Microsoft accepts both names. */

const KEYS = ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];

async function freshEnv(vars: Record<string, string>) {
  for (const k of KEYS) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.resetModules();
  return import("./env");
}

afterEach(() => vi.unstubAllEnvs());

describe("calendar env gating", () => {
  it("everything off when unset", async () => {
    const { integrations } = await freshEnv({});
    expect(integrations.google()).toBe(false);
    expect(integrations.microsoft()).toBe(false);
  });
  it("Google needs both id and secret", async () => {
    expect((await freshEnv({ GOOGLE_CLIENT_ID: "x" })).integrations.google()).toBe(false);
    expect((await freshEnv({ GOOGLE_CLIENT_ID: "x", GOOGLE_CLIENT_SECRET: "y" })).integrations.google()).toBe(true);
  });
  it("Microsoft works with MICROSOFT_* (documented) or MS_* (older) names", async () => {
    const a = await freshEnv({ MICROSOFT_CLIENT_ID: "a", MICROSOFT_CLIENT_SECRET: "b" });
    expect(a.integrations.microsoft()).toBe(true);
    expect(a.env.MS_CLIENT_ID).toBe("a");
    const b = await freshEnv({ MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "d" });
    expect(b.integrations.microsoft()).toBe(true);
    const c = await freshEnv({ MICROSOFT_CLIENT_ID: "a", MS_CLIENT_ID: "old", MS_CLIENT_SECRET: "d" });
    expect(c.env.MS_CLIENT_ID).toBe("a");
  });
});
