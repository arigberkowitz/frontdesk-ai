import { describe, expect, it, vi } from "vitest";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
let status = "live";

vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test", AGENT_TOOLS_SECRET: "s" } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/clients", () => ({
  getClientForChat: async () => ({ id: CLIENT_ID, name: "Acme", status, agentName: "Riley", waitlistEnabled: false }),
}));
vi.mock("@/lib/agent-publish", () => ({ buildPromptForClient: () => "" }));
vi.mock("@/lib/agents/anthropic", () => ({ CHAT_MODEL: "m", getAnthropic: () => ({}) }));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatTurn: async () => true }));

const { POST } = await import("./route");
const post = (body: unknown, ipAddr = "203.0.113.1") =>
  POST(
    new Request("https://app.test/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ipAddr },
      body: JSON.stringify(body),
    }),
  );

describe("public chat gates", () => {
  it("refuses paused businesses", async () => {
    status = "paused";
    const res = await post({ clientId: CLIENT_ID, messages: [] }, "203.0.113.2");
    expect(res.status).toBe(404);
    status = "live";
  });

  it("serves the greeting for an active business", async () => {
    const res = await post({ clientId: CLIENT_ID }, "203.0.113.3");
    expect(res.status).toBe(200);
    expect((await res.json()).reply).toContain("Riley");
  });

  it("rate-limits a single IP", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) codes.push((await post({ clientId: CLIENT_ID }, "203.0.113.9")).status);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes.slice(20).every((c) => c === 429)).toBe(true);
  });
});
