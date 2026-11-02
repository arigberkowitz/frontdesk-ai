import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
const sendEmail = vi.fn();
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail: (...a: unknown[]) => sendEmail(...a) } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { sendContactMessageAction } from "./contact";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const good = { name: "Pat", email: "pat@example.com", subject: "Hi", message: "Interested" };

describe("sendContactMessageAction", () => {
  beforeEach(() => sendEmail.mockReset().mockResolvedValue({ ok: true }));

  it("rejects a bad email without sending", async () => {
    const r = await sendContactMessageAction({ ok: false }, form({ ...good, email: "nope" }));
    expect(r.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("silently drops honeypot submissions", async () => {
    const r = await sendContactMessageAction({ ok: false }, form({ ...good, company: "Spam Inc" }));
    expect(r.ok).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("rate-limits one IP after 5 sends", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await sendContactMessageAction({ ok: false }, form(good))).ok).toBe(true);
    }
    const r = await sendContactMessageAction({ ok: false }, form(good));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/try again/);
    expect(sendEmail).toHaveBeenCalledTimes(5);
  });
});
