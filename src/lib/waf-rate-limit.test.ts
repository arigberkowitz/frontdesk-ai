import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const checkRateLimit = vi.fn();
vi.mock("@vercel/firewall", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

const warn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() },
}));

const req = () => new Request("https://frontdeskai.company/api/chat");

describe("wafRateLimited", () => {
  afterEach(() => {
    checkRateLimit.mockReset();
    warn.mockReset();
    vi.unstubAllEnvs();
  });

  it("fails open outside production without calling the SDK", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { wafRateLimited } = await import("./waf-rate-limit");
    await expect(wafRateLimited("public-chat", { request: req() })).resolves.toBe(false);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("returns true when the published rule is exceeded", async () => {
    vi.stubEnv("NODE_ENV", "production");
    checkRateLimit.mockResolvedValue({ rateLimited: true });
    const { wafRateLimited } = await import("./waf-rate-limit");
    await expect(wafRateLimited("public-chat", { request: req() })).resolves.toBe(true);
    expect(checkRateLimit).toHaveBeenCalledWith(
      "public-chat",
      expect.objectContaining({ request: expect.any(Request), timeout: 800 }),
    );
  });

  it("fails open when the dashboard rule does not exist yet", async () => {
    vi.stubEnv("NODE_ENV", "production");
    checkRateLimit.mockResolvedValue({ rateLimited: false, error: "not-found" });
    const { wafRateLimited } = await import("./waf-rate-limit");
    await expect(wafRateLimited("public-chat", { request: req() })).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith("waf.rate_limit.rule_missing", { rateLimitId: "public-chat" });
  });

  it("fails open when the check throws or times out", async () => {
    vi.stubEnv("NODE_ENV", "production");
    checkRateLimit.mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    const { wafRateLimited } = await import("./waf-rate-limit");
    await expect(wafRateLimited("public-chat", { request: req() })).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "waf.rate_limit.check_failed",
      expect.objectContaining({ rateLimitId: "public-chat" }),
    );
  });
});
