import { describe, expect, it, vi } from "vitest";

/** Prod Oct 14: "Let me send a verification code…" with no tool call. Now forced. */
const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const calls: Array<Record<string, unknown>> = [];
const replies = [
  { content: [{ type: "text", text: "Let me send a verification code to 415-747-5690." }] },
  { content: [{ type: "tool_use", id: "t1", name: "cancel_appointment", input: { phone: "4157475690" } }] },
  { content: [{ type: "text", text: "I've texted a 6-digit code to that number — type it here." }] },
];
const create = vi.fn(async (req: Record<string, unknown>) => (calls.push(req), replies[calls.length - 1]));
const fetchSpy = vi.fn(async (_url: unknown, _init?: unknown) => new Response(JSON.stringify({ code_sent: true, message: "ask for it" })));
vi.stubGlobal("fetch", fetchSpy);

vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test", AGENT_TOOLS_SECRET: "s" } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/clients", () => ({
  getClientForChat: async () => ({ id: CLIENT_ID, name: "Acme", status: "live", agentName: "Riley", waitlistEnabled: false, timezone: "America/Los_Angeles" }),
}));
vi.mock("@/lib/agent-publish", () => ({ buildPromptForClient: () => "" }));
vi.mock("@/lib/agents/anthropic", () => ({ CHAT_MODEL: "m", getAnthropic: () => ({ messages: { create } }) }));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatTurn: async () => true }));

const { POST } = await import("./route");

describe("chat never promises a code without sending it", () => {
  it("forces cancel_appointment when the model only announces the send", async () => {
    const res = await POST(new Request("https://app.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify({ clientId: CLIENT_ID, messages: [{ role: "user", content: "cancel my booking for 415-747-5690" }] }),
    }));
    const body = await res.json();
    expect(calls[1].tool_choice).toEqual({ type: "tool", name: "cancel_appointment" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("cancel");
    expect(body.reply).toMatch(/type it here/);
  });
});
