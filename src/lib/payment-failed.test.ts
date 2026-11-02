import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sent: { to: string; subject: string; text: string }[] = [];
let subRow: { clientId: string } | undefined;
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail: async (m: never) => { sent.push(m); return { ok: true }; } } }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test" } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/clients", () => ({
  getClientByIdUnsafe: async (id: string) =>
    id === "c1" ? { id, name: "Bayside <Plumbing>", ownerEmail: "owner@x.test", timezone: "America/New_York" } : id === "c2" ? { id, name: "No Email", ownerEmail: null } : null,
}));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => (subRow ? [subRow] : []) }) }) }) },
}));

const { notifyPaymentFailed } = await import("./payment-failed");

const inv = (o: Record<string, unknown>) => ({ id: "in_1", amount_due: 30000, customer: "cus_1", ...o }) as never;

describe("notifyPaymentFailed", () => {
  beforeEach(() => { sent.length = 0; subRow = undefined; });

  it("emails the owner with amount and fix link, using subscription metadata", async () => {
    const ok = await notifyPaymentFailed(inv({ parent: { subscription_details: { metadata: { clientId: "c1" } } } }));
    expect(ok).toBe(true);
    expect(sent[0].to).toBe("owner@x.test");
    expect(sent[0].text).toContain("$300.00");
    expect(sent[0].text).toContain("https://app.test/portal/settings");
    expect((sent[0] as unknown as { html: string }).html).toContain("Bayside &#60;Plumbing&#62;");
  });

  it("falls back to the stored Stripe customer", async () => {
    subRow = { clientId: "c1" };
    expect(await notifyPaymentFailed(inv({}))).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("does nothing for an unknown business or one without an owner email", async () => {
    expect(await notifyPaymentFailed(inv({}))).toBe(false);
    expect(await notifyPaymentFailed(inv({ parent: { subscription_details: { metadata: { clientId: "c2" } } } }))).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
