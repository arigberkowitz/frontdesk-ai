import { beforeEach, describe, expect, it, vi } from "vitest";

/* The live vendor wiring, with the three SDKs mocked: no network, no keys. */

const retell = {
  post: vi.fn(),
  phoneNumber: { list: vi.fn(), delete: vi.fn(), update: vi.fn() },
  agent: { retrieve: vi.fn(), delete: vi.fn() },
  llm: { retrieve: vi.fn(), delete: vi.fn() },
  call: { delete: vi.fn() },
};
const iter = <T,>(items: T[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const i of items) yield i;
  },
});
const stripe = {
  subscriptions: { retrieve: vi.fn(), cancel: vi.fn(), list: vi.fn(), search: vi.fn() },
  subscriptionSchedules: { cancel: vi.fn(), list: vi.fn() },
  invoices: { list: vi.fn(), voidInvoice: vi.fn(), del: vi.fn() },
  invoiceItems: { list: vi.fn(), del: vi.fn() },
  checkout: { sessions: { list: vi.fn(), expire: vi.fn() } },
};
const twilioNumbers = Object.assign(vi.fn(), { list: vi.fn() });
const twilioClientMock = { incomingPhoneNumbers: twilioNumbers, messaging: { v1: { tollfreeVerifications: vi.fn() } } };

vi.mock("@/lib/retell", () => ({ getRetellClient: () => retell }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => stripe }));
vi.mock("twilio", () => ({ default: () => twilioClientMock }));
vi.mock("@/lib/env", () => ({
  env: { TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM_NUMBER: "+16283135682" },
  integrations: { retell: () => true, stripe: () => true, twilio: () => true },
  webhookUrl: (p: string) => `https://x.test${p}`,
}));
vi.mock("@/lib/google-calendar", () => ({ revokeGoogleToken: vi.fn(async () => true) }));
vi.mock("@/lib/crypto", () => ({ decryptSecret: (s: string) => (s === "bad" ? (() => { throw new Error("x"); })() : `plain:${s}`) }));

import { liveProviders } from "./providers";

const CLIENT = "8d787138-bf6e-47a6-9e49-36ea6596cd7d";

beforeEach(() => vi.clearAllMocks());

describe("Retell: removed legacy endpoints are not used", () => {
  it("lists agents through POST /v2/list-agents (GET /list-agents was removed 2026-07-31) and pages", async () => {
    retell.post
      .mockResolvedValueOnce({ items: [{ agent_id: "a1", agent_name: "Riley", user_modified_timestamp: 5 }], has_more: true, pagination_key: "k1" })
      .mockResolvedValueOnce({ items: [{ agent_id: "a2" }], has_more: false });
    const out = await liveProviders().listRetellAgents();
    expect(out.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(retell.post).toHaveBeenCalledTimes(2);
    expect(retell.post.mock.calls[0][0]).toBe("/v2/list-agents");
    expect(retell.post.mock.calls[1][1].query.pagination_key).toBe("k1");
  });
});

describe("retellNumbersFor", () => {
  it("finds numbers by the one on file, by agent binding, and by the business-id nickname; not strangers'", async () => {
    retell.phoneNumber.list.mockResolvedValue({
      items: [
        { phone_number: "+12272382281", nickname: null, inbound_agents: [] },
        { phone_number: "+16285550101", nickname: "Riley (8d787138)", inbound_agents: [] },
        { phone_number: "+16285550102", nickname: null, inbound_agents: [{ agent_id: "agent_x" }] },
        { phone_number: "+16285007282", nickname: "Allie (48c65f7d)", inbound_agents: [{ agent_id: "agent_other" }] },
      ],
      has_more: false,
    });
    const found = await liveProviders().retellNumbersFor({ clientId: CLIENT, agentId: "agent_x", phone: "+1 (227) 238-2281" });
    expect(found.sort()).toEqual(["+12272382281", "+16285550101", "+16285550102"]);
  });
});

describe("existence checks treat a 404 as gone and anything else as an error", () => {
  it("agent", async () => {
    retell.agent.retrieve.mockRejectedValueOnce({ status: 404 });
    expect(await liveProviders().retellAgentExists("a")).toBe(false);
    retell.agent.retrieve.mockResolvedValueOnce({});
    expect(await liveProviders().retellAgentExists("a")).toBe(true);
    retell.agent.retrieve.mockRejectedValueOnce({ status: 500, message: "boom" });
    await expect(liveProviders().retellAgentExists("a")).rejects.toBeTruthy();
  });
});

describe("Twilio: only this business's numbers, never the shared sender", () => {
  it("twilioNumbersNamed excludes the shared sender even if it has the same name", async () => {
    twilioNumbers.list.mockResolvedValue([
      { sid: "PN1", phoneNumber: "+18885551234", friendlyName: "FrontDesk SMS · Bright Smile Dental" },
      { sid: "PN_SHARED", phoneNumber: "+16283135682", friendlyName: "FrontDesk SMS · Bright Smile Dental" },
      { sid: "PN3", phoneNumber: "+18885550000", friendlyName: "FrontDesk SMS · Someone Else" },
    ]);
    const out = await liveProviders().twilioNumbersNamed("FrontDesk SMS · Bright Smile Dental");
    expect(out).toEqual([{ sid: "PN1", phone: "+18885551234" }]);
  });
});

describe("Stripe wind-down", () => {
  it("cancels schedules, voids open invoices, deletes drafts and pending charges, expires this business's open checkouts only", async () => {
    stripe.subscriptionSchedules.list.mockReturnValue(iter([{ id: "sched_1", status: "active" }, { id: "sched_2", status: "completed" }]));
    stripe.invoices.list.mockImplementation((q: { status: string }) => iter(q.status === "open" ? [{ id: "in_open" }] : [{ id: "in_draft" }]));
    stripe.invoiceItems.list.mockReturnValue(iter([{ id: "ii_1" }]));
    stripe.checkout.sessions.list.mockReturnValue(
      iter([
        { id: "cs_mine", metadata: { clientId: CLIENT }, customer: null },
        { id: "cs_cust", metadata: {}, customer: "cus_1" },
        { id: "cs_other", metadata: { clientId: "someone-else" }, customer: "cus_2" },
      ]),
    );
    const r = await liveProviders().stripeWindDown({ clientId: CLIENT, customerId: "cus_1" });
    expect(r).toEqual({ schedulesCanceled: 1, invoicesVoided: 1, draftInvoicesDeleted: 1, pendingItemsRemoved: 1, checkoutsExpired: 2 });
    expect(stripe.subscriptionSchedules.cancel).toHaveBeenCalledWith("sched_1", { invoice_now: false, prorate: false });
    expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith("in_open");
    expect(stripe.invoices.del).toHaveBeenCalledWith("in_draft");
    expect(stripe.invoiceItems.del).toHaveBeenCalledWith("ii_1");
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_mine");
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_cust");
    expect(stripe.checkout.sessions.expire).not.toHaveBeenCalledWith("cs_other");
  });

  it("inventory counts live subscriptions (by customer AND by our metadata), open+draft invoices, pending items, schedules and checkouts", async () => {
    stripe.subscriptions.list.mockReturnValue(iter([{ id: "s1", status: "active" }, { id: "s2", status: "canceled" }]));
    stripe.subscriptions.search.mockReturnValue(iter([{ id: "s1", status: "active" }, { id: "s3", status: "trialing" }]));
    stripe.invoices.list.mockImplementation((q: { status: string }) => iter(q.status === "open" ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }]));
    stripe.invoiceItems.list.mockReturnValue(iter([{ id: "i" }]));
    stripe.subscriptionSchedules.list.mockReturnValue(iter([{ id: "x", status: "not_started" }]));
    stripe.checkout.sessions.list.mockReturnValue(iter([{ id: "cs", metadata: { clientId: CLIENT }, customer: null }]));
    expect(await liveProviders().stripeInventory({ clientId: CLIENT, customerId: "cus_1" })).toEqual({
      activeSubscriptions: 2,
      openInvoices: 3,
      pendingItems: 1,
      activeSchedules: 1,
      openCheckouts: 1,
    });
  });

  it("with no customer at all it still finds subscriptions and checkouts by the business id", async () => {
    stripe.subscriptions.search.mockReturnValue(iter([{ id: "s9", status: "active" }]));
    stripe.checkout.sessions.list.mockReturnValue(iter([{ id: "cs", metadata: { clientId: CLIENT }, customer: null }]));
    const inv = await liveProviders().stripeInventory({ clientId: CLIENT, customerId: null });
    expect(inv.activeSubscriptions).toBe(1);
    expect(inv.openCheckouts).toBe(1);
    expect(stripe.invoices.list).not.toHaveBeenCalled();
  });

  it("canceling a subscription run by a schedule cancels the schedule first", async () => {
    stripe.subscriptions.retrieve.mockResolvedValue({ status: "active", schedule: "sched_9" });
    stripe.subscriptions.cancel.mockResolvedValue({});
    await liveProviders().stripeCancel("sub_1", { prorate: false });
    expect(stripe.subscriptionSchedules.cancel.mock.invocationCallOrder[0]).toBeLessThan(stripe.subscriptions.cancel.mock.invocationCallOrder[0]);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1", { prorate: false, invoice_now: false });
  });
});

describe("calendar revoke", () => {
  it("Google is revoked with the decrypted token; Cal.com / Microsoft are removed locally and flagged manual; unreadable secrets don't throw", async () => {
    const p = liveProviders();
    expect(await p.revokeCalendar("google", "tok")).toBe("revoked");
    expect(await p.revokeCalendar("calcom", "tok")).toBe("manual");
    expect(await p.revokeCalendar("google", "bad")).toBe("manual");
    expect(await p.revokeCalendar(null, null)).toBe("none");
  });
});
