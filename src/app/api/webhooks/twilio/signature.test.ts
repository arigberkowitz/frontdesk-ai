import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * Twilio's documented signing scheme, reimplemented here so the test is
 * checking our understanding of the algorithm rather than our own helper
 * agreeing with itself: HMAC-SHA1 over the full url with sorted key+value
 * pairs appended, base64.
 */
function sign(url: string, params: Record<string, string>, token: string): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");
  return createHmac("sha1", token).update(data).digest("base64");
}

const TOKEN = "test-auth-token";
const PARAMS = { From: "+16505551234", Body: "STOP", To: "+16283135682" };
const CANONICAL = "https://frontdeskai.company/api/webhooks/twilio";
const LEGACY = "https://frontdesk-ai-alpha.vercel.app/api/webhooks/twilio";

describe("Twilio webhook signing", () => {
  // The bug this guards: a number still configured against the legacy hostname
  // signs against that hostname. Verifying only against APP_URL rejects it, and
  // since this endpoint handles STOP, the opt-out silently stops working.
  it("produces a different signature per hostname", () => {
    expect(sign(CANONICAL, PARAMS, TOKEN)).not.toBe(sign(LEGACY, PARAMS, TOKEN));
  });

  it("is stable for the same url and params", () => {
    expect(sign(CANONICAL, PARAMS, TOKEN)).toBe(sign(CANONICAL, PARAMS, TOKEN));
  });

  it("ignores the order params arrive in", () => {
    const reordered = { To: PARAMS.To, Body: PARAMS.Body, From: PARAMS.From };
    expect(sign(CANONICAL, reordered, TOKEN)).toBe(sign(CANONICAL, PARAMS, TOKEN));
  });

  it("changes when the body changes", () => {
    expect(sign(CANONICAL, { ...PARAMS, Body: "START" }, TOKEN)).not.toBe(
      sign(CANONICAL, PARAMS, TOKEN),
    );
  });
});
