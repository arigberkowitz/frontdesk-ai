import { beforeEach, describe, expect, it, vi } from "vitest";

const checkBotId = vi.fn();
vi.mock("botid/server", () => ({ checkBotId: (...a: unknown[]) => checkBotId(...a) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { checkPublicBot, botForbiddenResponse, BOT_BLOCKED_MESSAGE } = await import("./botid");

describe("checkPublicBot", () => {
  beforeEach(() => {
    checkBotId.mockReset();
    vi.unstubAllEnvs();
  });

  it("fail-opens in test/dev without calling Vercel (official BotID does the same when NODE_ENV !== production)", async () => {
    const r = await checkPublicBot();
    expect(r).toEqual({ isBot: false });
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("blocks when production checkBotId says the request is a bot", async () => {
    vi.stubEnv("NODE_ENV", "production");
    checkBotId.mockResolvedValue({ isBot: true, isHuman: false, isVerifiedBot: false, bypassed: false });
    const r = await checkPublicBot();
    expect(r).toEqual({ isBot: true, message: BOT_BLOCKED_MESSAGE });
    expect(checkBotId).toHaveBeenCalledWith(
      expect.objectContaining({ advancedOptions: { checkLevel: "basic" } }),
    );
  });

  it("lets a human through in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    checkBotId.mockResolvedValue({ isBot: false, isHuman: true, isVerifiedBot: false, bypassed: false });
    await expect(checkPublicBot()).resolves.toEqual({ isBot: false });
  });

  it("fail-opens and logs when checkBotId throws in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    checkBotId.mockRejectedValue(new Error("oidc missing"));
    await expect(checkPublicBot()).resolves.toEqual({ isBot: false });
  });

  it("honors BOTID_DEV_BYPASS=BAD-BOT in non-production so the block path is testable locally", async () => {
    vi.stubEnv("BOTID_DEV_BYPASS", "BAD-BOT");
    checkBotId.mockResolvedValue({ isBot: true, isHuman: false, isVerifiedBot: false, bypassed: false });
    const r = await checkPublicBot();
    expect(r.isBot).toBe(true);
    expect(checkBotId).toHaveBeenCalledWith(
      expect.objectContaining({ developmentOptions: { bypass: "BAD-BOT" } }),
    );
  });
});

describe("botForbiddenResponse", () => {
  it("returns a 403 with the friendly message", async () => {
    const res = botForbiddenResponse();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: BOT_BLOCKED_MESSAGE });
  });
});
