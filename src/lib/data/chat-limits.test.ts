import { describe, expect, it, vi } from "vitest";

// Simulate the enum migration not having landed: every query throws, so the
// caps must still hold via the in-memory fallback rather than failing open.
vi.mock("@/db", () => ({
  db: {
    select: () => {
      throw new Error('invalid input value for enum agent_run_kind: "web_chat_sms"');
    },
    insert: () => {
      throw new Error("unreachable");
    },
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { allowChatSms, allowChatTurn, CHAT_SMS_PER_PHONE_PER_DAY, CHAT_SMS_PER_CLIENT_PER_DAY } =
  await import("./chat-limits");

describe("chat limits (fallback path)", () => {
  it("caps texts to one number per business per day", async () => {
    const client = `c-${Math.random()}`;
    for (let i = 0; i < CHAT_SMS_PER_PHONE_PER_DAY; i++) {
      expect(await allowChatSms(client, "+14155550100", "booking_confirmation")).toBe(true);
    }
    expect(await allowChatSms(client, "(415) 555-0100", "cancel_code")).toBe(false);
    // A different number is still allowed.
    expect(await allowChatSms(client, "+14155550101", "booking_confirmation")).toBe(true);
  });

  it("caps total chat texts per business per day", async () => {
    const client = `c-${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < CHAT_SMS_PER_CLIENT_PER_DAY + 5; i++) {
      if (await allowChatSms(client, `+1415555${String(1000 + i)}`, "booking_confirmation")) allowed++;
    }
    expect(allowed).toBe(CHAT_SMS_PER_CLIENT_PER_DAY);
  });

  it("refuses an unusable number", async () => {
    expect(await allowChatSms("c", "", "booking_confirmation")).toBe(false);
  });

  it("counts chat turns", async () => {
    expect(await allowChatTurn(`c-${Math.random()}`)).toBe(true);
  });
});
