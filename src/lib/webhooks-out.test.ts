import { describe, it, expect, vi } from "vitest";
import {
  deliver,
  generateWebhookSecret,
  isDeliverableUrl,
  signatureHeader,
  verifySignature,
  type WebhookPayload,
} from "./webhooks-out";

const payload: WebhookPayload = {
  id: "evt_1",
  event: "lead.created",
  createdAt: "2026-08-27T12:00:00.000Z",
  clientId: "client_1",
  data: { name: "Jordan Lee" },
};

describe("signatures", () => {
  it("round-trips", () => {
    const header = signatureHeader("whsec_abc", '{"a":1}', 1_700_000_000);
    expect(verifySignature("whsec_abc", '{"a":1}', header)).toBe(true);
  });

  it("fails on a different secret, body, or timestamp", () => {
    const header = signatureHeader("whsec_abc", '{"a":1}', 1_700_000_000);
    expect(verifySignature("whsec_xyz", '{"a":1}', header)).toBe(false);
    expect(verifySignature("whsec_abc", '{"a":2}', header)).toBe(false);
    // The timestamp is inside the signed string, so rewriting it breaks the mac.
    expect(verifySignature("whsec_abc", '{"a":1}', header.replace(/t=\d+/, "t=1"))).toBe(false);
  });

  it("rejects garbage headers instead of throwing", () => {
    expect(verifySignature("whsec_abc", "{}", "")).toBe(false);
    expect(verifySignature("whsec_abc", "{}", "v1=deadbeef")).toBe(false);
  });

  it("generates distinct secrets", () => {
    expect(generateWebhookSecret()).not.toEqual(generateWebhookSecret());
    expect(generateWebhookSecret()).toMatch(/^whsec_/);
  });
});

describe("isDeliverableUrl", () => {
  it("accepts a normal https endpoint", () => {
    expect(isDeliverableUrl("https://hooks.zapier.com/abc")).toBe(true);
  });

  it("refuses plaintext http — these payloads carry names and phone numbers", () => {
    expect(isDeliverableUrl("http://hooks.zapier.com/abc")).toBe(false);
  });

  it("refuses loopback, link-local and RFC1918 — this is an SSRF primitive", () => {
    for (const u of [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://[::1]/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/hook",
      "https://192.168.1.10/hook",
      "https://172.16.0.4/hook",
    ]) {
      expect(isDeliverableUrl(u), u).toBe(false);
    }
  });

  it("still allows public addresses that merely look adjacent", () => {
    expect(isDeliverableUrl("https://172.32.0.1/hook")).toBe(true);
    expect(isDeliverableUrl("https://11.0.0.1/hook")).toBe(true);
  });

  it("refuses nonsense rather than throwing", () => {
    expect(isDeliverableUrl("not a url")).toBe(false);
    expect(isDeliverableUrl("")).toBe(false);
  });
});

describe("deliver", () => {
  const cfg = { url: "https://hooks.example.com/x", secret: "whsec_abc" };

  it("signs the body it actually sends", async () => {
    let seenBody = "";
    let seenSig = "";
    const f = vi.fn(async (_u: unknown, init?: RequestInit) => {
      seenBody = String(init?.body ?? "");
      seenSig = String((init?.headers as Record<string, string>)["x-frontdesk-signature"]);
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await deliver(cfg, payload, f, () => 1_700_000_000);
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
    expect(verifySignature("whsec_abc", seenBody, seenSig)).toBe(true);
  });

  it("retries a 500 and succeeds", async () => {
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      return new Response("", { status: n < 3 ? 500 : 200 });
    }) as unknown as typeof fetch;
    const res = await deliver(cfg, payload, f, () => 1);
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(3);
  });

  it("does not retry a 4xx — the receiver understood and said no", async () => {
    const f = vi.fn(async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    const res = await deliver(cfg, payload, f, () => 1);
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(1);
    expect(res.status).toBe(401);
  });

  it("never throws when the network does", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const res = await deliver(cfg, payload, f, () => 1);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ECONNREFUSED");
  });

  it("refuses to call a blocked URL at all", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const res = await deliver({ url: "https://127.0.0.1/x", secret: "s" }, payload, f, () => 1);
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing is configured", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const res = await deliver({}, payload, f, () => 1);
    expect(res.attempts).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});
