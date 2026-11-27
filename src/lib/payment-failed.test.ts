import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sent: { to: string; subject: string; text: string }[] = [];
let subRow: { clientId: string } | undefined;
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail: async (m: never) => { sent.push(m); return { ok: true }; } } }));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "https://app.test", ALERT_EMAIL: "ari@frontdesk.test" } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/clients", () => ({
  getClientByIdUnsafe: async (id: string) =>
    id === "c1" ? { id, name: "Bayside <Plumbing>", ownerEmail: "owner@x.test", timezone: "America/New_York" } : id === "c2" ? { id, name: "No Email", ownerEmail: null } : null,
}));
// The once-per-invoice claim for Ari's email: the stored value per business.
const claims = new Map<string, string>();
let claimArgs: { clientId: string; value: string } | null = null;
vi.mock("drizzle-orm", async (orig) => {
  const real = await orig<typeof import("drizzle-orm")>();
  return {
    ...real,
    // Capture the claim's (clientId, value) from the WHERE template.
    sql: Object.assign(
      (strings: TemplateStringsArray, ...vals: unknown[]) => {
        if (strings.join("?").includes("billingAlerts'->>") && vals.length >= 3) {
          claimArgs = { clientId: String(vals[1]), value: String(vals[vals.length - 1]) };
        }
        return real.sql(strings, ...vals);
      },
      real.sql,
    ),
  };
});
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (subRow ? [subRow] : []) }) }) }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            const a = claimArgs;
            if (!a || claims.get(a.clientId) === a.value) return [];
            claims.set(a.clientId, a.value);
            return [{ id: a.clientId }];
          },
        }),
      }),
    }),
  },
}));

const { notifyPaymentFailed, notifyBillingHold } = await import("./payment-failed");

const inv = (o: Record<string, unknown>) => ({ id: "in_1", amount_due: 30000, customer: "cus_1", ...o }) as never;

describe("notifyPaymentFailed", () => {
  beforeEach(() => { sent.length = 0; subRow = undefined; claims.clear(); });

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
    expect(sent.filter((m) => m.to === "owner@x.test")).toHaveLength(1);
  });

  it("tells Ari too — once per invoice, however many retries fail", async () => {
    const failed = inv({ parent: { subscription_details: { metadata: { clientId: "c1" } } } });
    await notifyPaymentFailed(failed);
    await notifyPaymentFailed(failed); // Stripe's next retry, same invoice
    expect(sent.filter((m) => m.to === "owner@x.test")).toHaveLength(2); // each retry reminds the owner
    const ari = sent.filter((m) => m.to === "ari@frontdesk.test");
    expect(ari).toHaveLength(1);
    expect(ari[0].subject).toContain("Payment failed");
    expect(ari[0].text).toContain("$300.00");
    // A new invoice is a new problem.
    await notifyPaymentFailed(inv({ id: "in_2", parent: { subscription_details: { metadata: { clientId: "c1" } } } }));
    expect(sent.filter((m) => m.to === "ari@frontdesk.test")).toHaveLength(2);
  });

  it("does nothing for an unknown business or one without an owner email", async () => {
    expect(await notifyPaymentFailed(inv({}))).toBe(false);
    expect(await notifyPaymentFailed(inv({ parent: { subscription_details: { metadata: { clientId: "c2" } } } }))).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe("notifyBillingHold", () => {
  beforeEach(() => { sent.length = 0; claims.clear(); });

  it("a canceled plan: the owner hears what still works and how to turn it back on; Ari hears once", async () => {
    await notifyBillingHold("c1", "canceled", "canceled:sub_1");
    await notifyBillingHold("c1", "canceled", "canceled:sub_1");
    const owner = sent.filter((m) => m.to === "owner@x.test");
    expect(owner[0].subject).toBe("FrontDesk AI — your plan has ended");
    expect(owner[0].text).toContain("only takes messages");
    expect(owner[0].text).toContain("https://app.test/portal/guidelines?plans=open#plans");
    expect(owner[0].text).toContain("*73");
    expect(sent.filter((m) => m.to === "ari@frontdesk.test")).toHaveLength(1);
  });

  it("unpaid: points the owner at updating the card", async () => {
    await notifyBillingHold("c1", "unpaid", "unpaid:sub_1");
    const owner = sent.find((m) => m.to === "owner@x.test")!;
    expect(owner.subject).toBe("FrontDesk AI — your plan is on hold");
    expect(owner.text).toContain("Update your card");
  });

  it("unknown business: nothing sent", async () => {
    await notifyBillingHold("nope", "canceled", "canceled:sub_9");
    expect(sent).toHaveLength(0);
  });
});
