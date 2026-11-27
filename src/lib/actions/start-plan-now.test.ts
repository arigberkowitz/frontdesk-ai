import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Start my plan now": an owner with a card saved during the free trial ends
 * the Stripe trial early so the first payment (and the phone number) happen
 * today. Owner-only, Stripe-trial-only, and nothing reaches Stripe otherwise.
 */

let owner = true;
let sub: { subId: string | null; status: string } | undefined;
const update = vi.fn(async (_id: string, _p: Record<string, unknown>) => ({}));
const audit = vi.fn(async () => {});

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireClientOwner: async () => (owner ? { ok: true, user: { id: "u1", orgId: "o1" } } : { ok: false, error: "Only the owner can do that." }),
  requireOperator: vi.fn(),
}));
vi.mock("@/lib/data/clients", () => ({ assertClientInOrg: async () => {}, getClient: vi.fn() }));
vi.mock("@/lib/data/audit", () => ({ audit: () => audit() }));
vi.mock("@/lib/data/trial", () => ({ getTrialState: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: {}, integrations: { stripe: () => true } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ subscriptions: { update } }) }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => (sub ? [sub] : []) }) }) }),
    }),
  },
}));

const { startPlanNowAction } = await import("./billing");
const form = () => {
  const f = new FormData();
  f.set("clientId", "c1");
  return f;
};

beforeEach(() => {
  owner = true;
  sub = { subId: "sub_1", status: "trialing" };
  update.mockClear();
  update.mockImplementation(async () => ({}));
  audit.mockClear();
});

describe("startPlanNowAction", () => {
  it("ends the Stripe trial now, with no proration, and says the card is charged today", async () => {
    const r = await startPlanNowAction({ ok: false }, form());
    expect(update).toHaveBeenCalledWith("sub_1", { trial_end: "now", proration_behavior: "none" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/card is being charged/);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it("is owner-only", async () => {
    owner = false;
    const r = await startPlanNowAction({ ok: false }, form());
    expect(r.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing without a card, or once the plan has started", async () => {
    sub = undefined;
    expect((await startPlanNowAction({ ok: false }, form())).ok).toBe(false);
    for (const status of ["active", "past_due", "canceled"]) {
      sub = { subId: "sub_1", status };
      expect((await startPlanNowAction({ ok: false }, form())).message).toMatch(/already started/);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("a Stripe error is reported plainly, not thrown", async () => {
    update.mockImplementation(async () => {
      throw new Error("card_declined");
    });
    const r = await startPlanNowAction({ ok: false }, form());
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/Couldn't start your plan/);
    expect(audit).not.toHaveBeenCalled();
  });
});
