import { beforeEach, describe, expect, it, vi } from "vitest";

/** Waitlist offer texts only go to numbers with stored waitlist consent. */

const now = new Date("2026-10-05T12:00:00Z");
const opening = {
  startAt: new Date("2026-10-06T15:00:00Z"),
  endAt: new Date("2026-10-06T15:30:00Z"),
  serviceId: null,
};
const entry = (id: string, phone: string, createdMin: number) => ({
  id,
  customerPhone: phone,
  customerName: null,
  serviceId: null,
  earliestAt: new Date("2026-10-05T00:00:00Z"),
  latestAt: new Date("2026-10-10T00:00:00Z"),
  status: "waiting",
  notifyCount: 0,
  createdAt: new Date(now.getTime() - createdMin * 60_000),
});

let consented = new Set<string>();
const sent: string[] = [];

vi.mock("@/db", () => ({ db: { query: { services: { findFirst: async () => null } } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/reminders", () => ({ createReminder: vi.fn() }));
vi.mock("@/lib/data/waitlist", () => ({
  listWaiting: async () => [entry("a", "+14155550100", 30), entry("b", "(415) 555-0101", 20)],
  markOffered: vi.fn(),
}));
vi.mock("@/lib/data/sms-optouts", () => ({
  isOptedOut: async () => false,
  normalizePhone: (raw: string) => {
    const d = raw.replace(/[^\d]/g, "");
    return d.length === 10 ? `1${d}` : d;
  },
}));
vi.mock("@/lib/data/waitlist-consent", () => ({ getWaitlistConsentedPhones: async () => consented }));
vi.mock("@/lib/notifier", () => ({
  notifier: {
    sendSms: async (m: { to: string }) => {
      sent.push(m.to);
      return { ok: true };
    },
  },
}));

const { offerFreedSlot } = await import("./waitlist-backfill");
const client = {
  id: "c1",
  name: "Acme",
  timezone: "America/New_York",
  waitlistEnabled: true,
  retellPhoneNumber: null,
} as unknown as Parameters<typeof offerFreedSlot>[0];

describe("waitlist offers require stored consent", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("texts only consented numbers", async () => {
    consented = new Set(["14155550100"]);
    expect(await offerFreedSlot(client, opening, now)).toBe(1);
    expect(sent).toEqual(["+14155550100"]);
  });

  it("matches consent regardless of phone formatting", async () => {
    consented = new Set(["14155550101"]);
    await offerFreedSlot(client, opening, now);
    expect(sent).toEqual(["(415) 555-0101"]);
  });

  it("fails closed: no consent rows (or a failed lookup) means no texts", async () => {
    consented = new Set();
    expect(await offerFreedSlot(client, opening, now)).toBe(0);
    expect(sent).toEqual([]);
  });
});
