import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { computeAvailability } from "@/lib/google-calendar";

/**
 * The production bug: "What times do you have Thursday?" at 11:50 PM PT Tue
 * returned Wednesday's slots as bare UTC (read as 4 PM). Now the requested day
 * is honoured in the business's tz, freebusy still filters, and slots carry a
 * local start + label.
 */
const HOURS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, isClosed: false, openTime: "09:00", closeTime: "17:00" }));
const CLIENT = {
  id: "c1", timezone: "America/Los_Angeles", businessHours: HOURS,
  services: [{ id: "s", name: "Consult", durationMin: 30, isActive: true }],
};
let args: Record<string, unknown> = {};
// Thursday 9:00–10:00 PT is busy on Google.
const BUSY = [{ start: "2026-10-15T16:00:00Z", end: "2026-10-15T17:00:00Z" }];
const getAvailability = vi.fn(async (q: { rangeStart: string; rangeEnd: string; durationMin: number; timezone: string; businessHours: never[] }) =>
  computeAvailability({ ...q, busy: BUSY, nowMs: Date.now() }).slots,
);
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/agent-tools-auth", () => ({ authorizeAgentTool: async () => ({ ok: true, client: CLIENT, args }) }));
vi.mock("@/lib/data/availability-blocks", () => ({ listActiveBlocks: async () => [] }));
vi.mock("@/lib/booking", () => ({ getBookingProviderForClient: () => ({ isConfigured: () => true, getAvailability }) }));

const { POST } = await import("./route");
const call = async () => (await POST(new Request("https://x/api", { method: "POST" }))).json();

beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-14T06:50:00Z")); });
afterAll(() => vi.useRealTimers());

describe("check-availability honours the requested day", () => {
  it("Thursday returns Thursday's open PT slots, minus freebusy", async () => {
    args = { service: "Consult", date_range: "Thursday" };
    const body = await call();
    expect(body.status).toBe("ok");
    expect(body.timezone).toBe("America/Los_Angeles");
    expect(body.available_slots[0]).toEqual({ start: "2026-10-15T10:00:00-07:00", label: "Thursday, October 15 at 10:00 AM" });
    for (const s of body.available_slots) expect(s.label).toMatch(/^Thursday, October 15 at/);
    expect(body.available_slots.map((s: { start: string }) => s.start)).not.toContain("2026-10-15T09:30:00-07:00");
  });
  it("no date_range keeps the next-7-days window, starting Wednesday 9 AM PT", async () => {
    args = { service: "Consult" };
    const body = await call();
    expect(body.available_slots[0]).toEqual({ start: "2026-10-14T09:00:00-07:00", label: "Wednesday, October 14 at 9:00 AM" });
  });
  it("a closed day says so without claiming the week is full", async () => {
    args = { service: "Consult", date_range: "Saturday" };
    const body = await call();
    expect(body.status).toBe("all_booked");
    expect(body.say).toMatch(/day\(s\) they asked for/);
  });
});
