import { afterEach, describe, expect, it, vi } from "vitest";

async function load(support: string) {
  vi.resetModules();
  vi.stubEnv("SUPPORT_EMAIL", support);
  return {
    notifier: await import("./notifier"),
    sms: await import("./sms-help"),
    life: await import("./lifecycle"),
  };
}
afterEach(() => vi.unstubAllEnvs());

describe("SUPPORT_EMAIL drives reply-to and help copy", () => {
  it("set: replies go to it, copy says just reply", async () => {
    const m = await load("help@frontdeskai.company");
    expect(m.notifier.emailReplyTo({} as never)).toBe("help@frontdeskai.company");
    expect(m.notifier.emailReplyTo({ replyTo: "x@y.com" } as never)).toBe("x@y.com");
    expect(m.sms.smsHelpReply()).toContain("help@frontdeskai.company");
    expect(m.life.questionsLine("https://h")).toMatch(/reply to this email/i);
  });
  it("unset: no reply-to, no gmail, copy points to portal help", async () => {
    const m = await load("");
    expect(m.notifier.emailReplyTo({} as never)).toBeUndefined();
    expect(m.sms.smsHelpReply()).not.toMatch(/gmail/i);
    expect(m.life.questionsLine("https://h/help")).toContain("https://h/help");
    expect(m.life.questionsLine("https://h/help")).not.toMatch(/reply to this email/i);
  });
});
