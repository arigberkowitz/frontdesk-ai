import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prod, Oct 14 2026 ~12:15 AM PT (Lawyers for justice): the visitor typed the
 * texted code 364064 and Riley replied "Got it. Your appointment has been
 * cancelled." — with no tool call. Vercel logs show no /api/agent-tools/cancel
 * request on that turn; the appointment and Google event were untouched.
 */
const CLIENT_ID = "9702a0b2-9065-41e7-b510-b11291278214";
let calls: Array<Record<string, unknown>> = [];
let replies: Array<{ content: unknown[] }> = [];
let toolResponses: unknown[] = [];
const create = vi.fn(async (req: Record<string, unknown>) => {
  calls.push(req);
  return replies[calls.length - 1];
});
const fetchSpy = vi.fn(async (_url: unknown, _init?: unknown) =>
  new Response(JSON.stringify(toolResponses.shift() ?? {})),
);
vi.stubGlobal("fetch", fetchSpy);

vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test", AGENT_TOOLS_SECRET: "s" } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/clients", () => ({
  getClientForChat: async () => ({ id: CLIENT_ID, name: "Lawyers for justice", status: "live", agentName: "Riley", waitlistEnabled: false, timezone: "America/Los_Angeles" }),
}));
vi.mock("@/lib/agent-publish", () => ({ buildPromptForClient: () => "" }));
vi.mock("@/lib/agents/anthropic", () => ({ CHAT_MODEL: "m", getAnthropic: () => ({ messages: { create } }) }));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatTurn: async () => true }));

const { POST } = await import("./route");

let ipN = 10;
async function send(messages: Array<{ role: string; content: string }>) {
  const res = await POST(new Request("https://app.test/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${ipN++}` },
    body: JSON.stringify({ clientId: CLIENT_ID, messages }),
  }));
  return (await res.json()) as { reply: string };
}

const CODE_TURN = [
  { role: "user", content: "I need to cancel my appointment, my number is 415-747-5690" },
  { role: "assistant", content: "I've sent a 6-digit code to the phone number on file. Please type it here." },
  { role: "user", content: "364064" },
];
const LIE = { content: [{ type: "text", text: "Got it. Your appointment has been cancelled." }] };
const CANCEL_USE = { content: [{ type: "tool_use", id: "c1", name: "cancel_appointment", input: { phone: "4157475690", code: "364064" } }] };

beforeEach(() => {
  calls = [];
  replies = [];
  toolResponses = [];
  fetchSpy.mockClear();
});

describe("cancel code turn (prod replay)", () => {
  it("always calls cancel_appointment when the visitor types the code", async () => {
    replies = [CANCEL_USE, { content: [{ type: "text", text: "Done — your appointment on Thursday at 10 AM has been cancelled." }] }];
    toolResponses = [{ success: true, message: "Cancelled: the appointment on Thu Oct 15, 10:00 AM." }];
    const body = await send(CODE_TURN);
    expect(calls[0].tool_choice).toEqual({ type: "tool", name: "cancel_appointment" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("cancel");
    const sent = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(sent.args.code).toBe("364064");
    expect(body.reply).toMatch(/has been cancelled/);
  });

  it("never says cancelled when the code check fails", async () => {
    replies = [CANCEL_USE, LIE];
    toolResponses = [{ success: false, verification_required: true, message: "That code doesn't match." }];
    const body = await send(CODE_TURN);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(body.reply).not.toMatch(/has been cancelled/);
    expect(body.reply).toMatch(/couldn't confirm/);
  });

  it("never says cancelled when the tool endpoint errors", async () => {
    replies = [CANCEL_USE, LIE];
    toolResponses = [{ error: "That didn't go through." }];
    const body = await send(CODE_TURN);
    expect(body.reply).toMatch(/couldn't confirm/);
  });
});

describe("general success-claim guard", () => {
  it("retries once with the forced tool when the model claims a booking without booking", async () => {
    replies = [
      { content: [{ type: "text", text: "You're all booked for Thursday at 10 AM!" }] },
      { content: [{ type: "tool_use", id: "b1", name: "book_appointment", input: { service: "consult" } }] },
      { content: [{ type: "text", text: "You're booked for Thursday at 10 AM." }] },
    ];
    toolResponses = [{ success: true, message: "Booked." }];
    const body = await send([{ role: "user", content: "yes book it" }]);
    expect(calls[1].tool_choice).toEqual({ type: "tool", name: "book_appointment" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(body.reply).toMatch(/booked/);
  });

  it("says it didn't work when the forced retry still doesn't back the claim", async () => {
    replies = [
      { content: [{ type: "text", text: "You're all booked for Thursday at 10 AM!" }] },
      { content: [{ type: "text", text: "You're all booked for Thursday at 10 AM!" }] },
    ];
    const body = await send([{ role: "user", content: "yes book it" }]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(body.reply).toMatch(/not booked yet/);
  });

  it("rejects a booking claim when book_appointment returned success:false", async () => {
    replies = [
      { content: [{ type: "tool_use", id: "b1", name: "book_appointment", input: {} }] },
      { content: [{ type: "text", text: "You're booked for Thursday at 10 AM." }] },
    ];
    toolResponses = [{ success: false, error: "That slot was just taken." }];
    const body = await send([{ role: "user", content: "yes book it" }]);
    expect(calls).toHaveLength(2);
    expect(body.reply).toMatch(/not booked yet/);
  });

  it("leaves ordinary replies alone", async () => {
    replies = [{ content: [{ type: "text", text: "Would you like me to cancel it? We're open 9 to 5." }] }];
    const body = await send([{ role: "user", content: "hours?" }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_choice).toBeUndefined();
    expect(body.reply).toMatch(/open 9 to 5/);
  });
});
