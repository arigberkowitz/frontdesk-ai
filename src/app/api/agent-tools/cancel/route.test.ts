import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may cancel an appointment. Voice: only the calling number. Web chat:
 * only after the visitor types back the code texted to the booking's number,
 * and nothing is revealed before that.
 */

const CLIENT = { id: "11111111-1111-4111-8111-111111111111", name: "Acme", timezone: "America/New_York" };
const APPT = {
  id: "appt-1",
  customerPhone: "+14155550100",
  customerName: "Pat",
  startAt: new Date(Date.now() + 86_400_000),
  endAt: new Date(Date.now() + 90_000_000),
  serviceId: null,
  externalBookingId: null,
  service: { name: "Cleaning" },
};

let authResult: Record<string, unknown>;
const sent: { to: string; body: string }[] = [];
const cancelled: string[] = [];

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { AGENT_TOOLS_SECRET: "s" }, integrations: { twilio: () => true } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/agent-tools-auth", () => ({ authorizeAgentTool: async () => authResult }));
vi.mock("@/lib/data/calls", () => ({ getCallByRetellId: async () => null }));
vi.mock("@/lib/data/appointments", () => ({
  findUpcomingAppointmentsByPhone: async (_c: string, phone: string) =>
    phone.replace(/\D/g, "").endsWith("4155550100") ? [APPT] : [],
  cancelAppointment: async (_c: string, id: string) => {
    cancelled.push(id);
    return APPT;
  },
}));
vi.mock("@/lib/booking", () => ({ getBookingProviderForClient: () => ({ isConfigured: () => false }) }));
vi.mock("@/lib/notify", () => ({ notifyOwnerCancellation: vi.fn() }));
vi.mock("@/lib/agents/waitlist-backfill", () => ({ offerFreedSlot: vi.fn() }));
vi.mock("@/lib/data/sms-optouts", () => ({
  isOptedOut: async () => false,
  normalizePhone: (raw: string) => {
    const d = raw.replace(/[^\d]/g, "");
    return d.length === 10 ? `1${d}` : d;
  },
}));
vi.mock("@/lib/data/chat-limits", () => ({ allowChatSms: async () => true }));
vi.mock("@/lib/notifier", () => ({
  notifier: {
    sendSms: async (m: { to: string; body: string }) => {
      sent.push(m);
      return { ok: true };
    },
  },
}));

const { POST } = await import("./route");
const req = () => new Request("https://app.test/api/agent-tools/cancel", { method: "POST" });
const voice = (args: Record<string, unknown>, fromNumber?: string) => {
  authResult = { ok: true, client: CLIENT, channel: "voice", args, call: { fromNumber } };
};
const chat = (args: Record<string, unknown>) => {
  authResult = { ok: true, client: CLIENT, channel: "web_chat", args, call: {} };
};

describe("cancel tool verification", () => {
  beforeEach(() => {
    sent.length = 0;
    cancelled.length = 0;
  });

  it("voice: cancels what's booked under the calling number", async () => {
    voice({}, "+14155550100");
    const body = await (await POST(req())).json();
    expect(body.success).toBe(true);
    expect(cancelled).toEqual(["appt-1"]);
  });

  it("voice: refuses a spoken number that isn't the caller ID", async () => {
    voice({ phone: "415-555-0100" }, "+12125550199");
    const body = await (await POST(req())).json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/only be cancelled from the phone number/);
    expect(cancelled).toEqual([]);
  });

  it("voice: refuses when there's no caller ID at all", async () => {
    voice({ phone: "4155550100" });
    const body = await (await POST(req())).json();
    expect(body.success).toBe(false);
    expect(cancelled).toEqual([]);
  });

  it("chat: first call texts a code and reveals nothing", async () => {
    chat({ phone: "4155550100" });
    const body = await (await POST(req())).json();
    expect(body.verification_required).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/Cleaning|Pat/);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("+14155550100");
    expect(cancelled).toEqual([]);
  });

  it("chat: an unknown number gets the same answer and no text", async () => {
    chat({ phone: "2125550199" });
    const known = await (await POST(req())).json();
    expect(known.verification_required).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("chat: a wrong code does not cancel", async () => {
    chat({ phone: "4155550100", code: "000000" });
    const body = await (await POST(req())).json();
    expect(body.success).toBe(false);
    expect(cancelled).toEqual([]);
  });

  it("chat: the texted code cancels", async () => {
    chat({ phone: "4155550100" });
    await POST(req());
    const code = /is (\d{6})/.exec(sent[0].body)?.[1];
    expect(code).toBeTruthy();
    chat({ phone: "4155550100", code });
    const body = await (await POST(req())).json();
    expect(body.success).toBe(true);
    expect(cancelled).toEqual(["appt-1"]);
  });

  it("chat: code guessing is throttled", async () => {
    const phone = "4155550100";
    for (let i = 0; i < 5; i++) {
      chat({ phone, code: String(100000 + i) });
      await POST(req());
    }
    chat({ phone, code: "999999" });
    const body = await (await POST(req())).json();
    expect(body.message).toMatch(/Too many code attempts/);
  });
});
