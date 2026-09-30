import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const mockEnv = { AGENT_TOOLS_SECRET: "tool-secret" };
vi.mock("@/lib/env", () => ({ env: mockEnv }));

const { signIntakeToken, verifyIntakeToken, LEGACY_TOKEN_CUTOFF_MS } = await import("./intake-token");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;

/** A token exactly as the old code minted it: HMAC keyed by the raw secret. */
function legacyToken(clientId: string, expiresAt: number, secret = "tool-secret"): string {
  const exp = String(expiresAt);
  const sig = createHmac("sha256", secret).update(`${clientId}.${exp}`).digest("base64url");
  return `${Buffer.from(clientId).toString("base64url")}.${Buffer.from(exp).toString("base64url")}.${sig}`;
}

describe("intake tokens", () => {
  it("round-trips a new token", () => {
    expect(verifyIntakeToken(signIntakeToken(CLIENT))).toBe(CLIENT);
  });

  it("new tokens are NOT keyed by the raw agent-tools secret", () => {
    const now = LEGACY_TOKEN_CUTOFF_MS - 40 * DAY;
    const token = signIntakeToken(CLIENT, 30 * DAY, now);
    const exp = now + 30 * DAY;
    expect(token).not.toBe(legacyToken(CLIENT, exp));
  });

  it("rejects tampering and expiry", () => {
    const token = signIntakeToken(CLIENT);
    const [, exp, sig] = token.split(".");
    const other = Buffer.from("22222222-2222-4222-8222-222222222222").toString("base64url");
    expect(verifyIntakeToken(`${other}.${exp}.${sig}`)).toBeNull();
    expect(verifyIntakeToken(signIntakeToken(CLIENT, -1))).toBeNull();
    expect(verifyIntakeToken("garbage")).toBeNull();
  });

  it("keeps old links working until they expire, up to the cutoff", () => {
    const now = LEGACY_TOKEN_CUTOFF_MS - 40 * DAY;
    expect(verifyIntakeToken(legacyToken(CLIENT, now + 30 * DAY), now)).toBe(CLIENT);
  });

  it("refuses a legacy-signed token whose expiry is past the cutoff", () => {
    const now = LEGACY_TOKEN_CUTOFF_MS - DAY;
    expect(verifyIntakeToken(legacyToken(CLIENT, LEGACY_TOKEN_CUTOFF_MS + DAY), now)).toBeNull();
  });

  it("fails closed without a secret", () => {
    const token = signIntakeToken(CLIENT);
    mockEnv.AGENT_TOOLS_SECRET = "";
    expect(verifyIntakeToken(token)).toBeNull();
    expect(verifyIntakeToken(signIntakeToken(CLIENT))).toBeNull();
    mockEnv.AGENT_TOOLS_SECRET = "tool-secret";
  });
});
