import { describe, expect, it } from "vitest";
import { deleteCompany, permanentDelete } from "./full-delete";
import { handleClientControl } from "./handler";
import { actor, makeWorld } from "./test-helpers";

const opts = { confirm: "Bright Smile Dental", blockFraud: false };
const st = (res: { steps: { step: string; status: string }[] }, id: string) => res.steps.filter((s) => s.step === id).map((s) => s.status);
const line = (res: { checklist?: { vendor: string; text: string; zero: boolean }[] }, vendor: string) => res.checklist?.find((l) => l.vendor === vendor);

/** A business with everything that can bill, plus the stragglers a real account collects. */
function fullWorld() {
  const w = makeWorld({ calendarProvider: "google", calendarSecret: "enc:token" }, { tollfree: true });
  w.state.tf = { phoneNumber: "+18885551234", phoneNumberSid: "PN1", verificationSid: "HH1" } as typeof w.state.tf;
  w.state.vendor.retellNumbers.add("+16285550101"); // a second number our DB never recorded
  w.state.vendor.twilioNumbers.set("PN2", "+18885559999"); // another texting number bought for it
  w.state.vendor.stripeSubs.add("sub_extra");
  w.state.vendor.stripe = { openInvoices: 2, pendingItems: 1, schedules: 1, checkouts: 1 };
  return w;
}

describe("delete company: nothing can bill afterwards", () => {
  it("releases every number (including ones the DB lost), deletes agent + LLM, cancels every subscription, winds Stripe down and revokes the calendar", async () => {
    const w = fullWorld();
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(true);
    expect(w.state.vendor.retellNumbers.size).toBe(0);
    expect(w.state.vendor.retellAgents.size).toBe(0);
    expect(w.state.vendor.retellLlms.size).toBe(0);
    expect(w.state.vendor.twilioNumbers.size).toBe(0);
    expect(w.state.vendor.stripeSubs.size).toBe(0);
    expect(w.providers.twilioDeleteTollfreeVerification).toHaveBeenCalledWith("HH1");
    expect(w.providers.revokeCalendar).toHaveBeenCalledWith("google", "enc:token");
    expect(w.state.client.calendarSecret).toBeNull();
    expect(w.state.client.calendarProvider).toBeNull();
    expect(w.state.work.queuedReminders).toBe(0);
    expect(w.state.client.deletedAt).toBeInstanceOf(Date);
    // every subscription canceled with no refund and no final invoice
    expect(w.providers.stripeCancel).toHaveBeenCalledWith("sub_1", { prorate: false });
    expect(w.providers.stripeCancel).toHaveBeenCalledWith("sub_extra", { prorate: false });
    expect(w.providers.stripeWindDown).toHaveBeenCalled();
    expect(st(res, "stripe_cleanup")).toEqual(["done"]);
    expect(st(res, "scheduled")).toEqual(["done"]);
  });

  it("ends with a checklist re-queried from the vendors, all at zero", async () => {
    const w = fullWorld();
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(line(res, "Retell")).toMatchObject({ text: "0 numbers, 0 agents, 0 LLMs", zero: true });
    expect(line(res, "Twilio")).toMatchObject({ text: "0 numbers", zero: true });
    expect(line(res, "Stripe")).toMatchObject({ text: "0 active subscriptions, 0 open invoices", zero: true });
    expect(line(res, "Calendar")?.zero).toBe(true);
    expect(line(res, "Jobs")?.zero).toBe(true);
    expect(w.providers.retellNumbersFor).toHaveBeenCalled();
    expect(w.providers.stripeInventory).toHaveBeenCalled();
  });

  it("does NOT report success when a vendor says it released something but still holds it", async () => {
    const w = fullWorld();
    // Retell answers "done" but the number is still there (a lying or lagging vendor).
    w.providers.retellReleaseNumber.mockImplementation(async () => "done");
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(502);
    expect(res.failedSteps).toContain("verify");
    expect(line(res, "Retell")?.zero).toBe(false);
    expect(line(res, "Retell")?.text).toMatch(/[12] numbers?/);
    // Not hidden from the lists: the operator can see it and Retry.
    expect(w.state.client.deletedAt).toBeNull();
    expect(res.message).toMatch(/nothing was reported as clean/i);
  });

  it("a Stripe invoice that is still open fails verification", async () => {
    const w = fullWorld();
    w.providers.stripeWindDown.mockImplementation(async () => ({ schedulesCanceled: 0, invoicesVoided: 0, draftInvoicesDeleted: 0, pendingItemsRemoved: 0, checkoutsExpired: 0 }));
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(false);
    expect(line(res, "Stripe")).toMatchObject({ zero: false });
    expect(line(res, "Stripe")?.text).toContain("2 open invoices");
    expect(w.state.client.deletedAt).toBeNull();
  });

  it("a Twilio number that survives the release fails verification", async () => {
    const w = fullWorld();
    w.providers.twilioReleaseNumber.mockImplementation(async () => "done");
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(false);
    expect(line(res, "Twilio")?.zero).toBe(false);
  });

  it("Retry after a Stripe failure finishes the job and only does what's left", async () => {
    const w = fullWorld();
    w.providers.stripeWindDown.mockRejectedValueOnce(new Error("Stripe 500"));
    const first = await deleteCompany(w.deps, actor, "c1", opts);
    expect(first.ok).toBe(false);
    expect(first.failedSteps).toEqual(expect.arrayContaining(["stripe_cleanup", "verify"]));
    expect(w.state.client.deletedAt).toBeNull();
    w.providers.retellReleaseNumber.mockClear();
    w.providers.retellDeleteAgent.mockClear();
    const second = await deleteCompany(w.deps, actor, "c1", opts);
    expect(second.ok).toBe(true);
    expect(w.providers.retellDeleteAgent).not.toHaveBeenCalled();
    expect(w.state.client.deletedAt).toBeInstanceOf(Date);
  });

  it("a vendor that isn't configured can't be verified, so a business that holds something there is not called clean", async () => {
    const w = makeWorld();
    w.providers.configured.retell = false;
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(false);
    expect(line(res, "Retell")?.text).toMatch(/can't be checked/);
    expect(w.state.client.deletedAt).toBeNull();
  });

  it("a calendar revoke that fails still removes the stored token, and never blocks", async () => {
    const w = fullWorld();
    w.providers.revokeCalendar.mockRejectedValueOnce(new Error("Google down"));
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(true);
    expect(w.state.client.calendarSecret).toBeNull();
    expect(res.steps.find((s) => s.step === "calendar")?.detail).toMatch(/owner can remove/);
  });

  it("a toll-free verification Twilio won't delete is free and never blocks", async () => {
    const w = fullWorld();
    w.providers.twilioDeleteTollfreeVerification.mockRejectedValueOnce(new Error("cannot delete"));
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(true);
    expect(st(res, "twilio_verification")).toEqual(["skipped"]);
  });

  it("finds a subscription Stripe stamped with the business id even when the DB has none on file", async () => {
    const w = makeWorld({}, { sub: false });
    w.state.vendor.stripeSubs.add("sub_orphan");
    w.providers.stripeSubscriptionsByClient.mockResolvedValueOnce(["sub_orphan"]);
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(true);
    expect(w.providers.stripeCancel).toHaveBeenCalledWith("sub_orphan", { prorate: false });
  });

  it("keeps the typed-name confirm and does nothing without it", async () => {
    const w = fullWorld();
    const res = await deleteCompany(w.deps, actor, "c1", { ...opts, confirm: "nope" });
    expect(res.httpStatus).toBe(400);
    expect(w.providers.retellReleaseNumber).not.toHaveBeenCalled();
    expect(w.store.mergeFlags).not.toHaveBeenCalled();
  });

  it("re-running on a company that was closed by its owner (soft-deleted) still sweeps the vendors", async () => {
    const w = fullWorld();
    w.state.client.deletedAt = new Date("2026-11-01T00:00:00Z");
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(true);
    expect(w.state.vendor.retellNumbers.size).toBe(0);
    expect(w.state.vendor.stripeSubs.size).toBe(0);
  });
});

describe("permanently delete now", () => {
  it("purges the database only after every vendor verifies clean, then re-counts to zero", async () => {
    const w = fullWorld();
    const order: string[] = [];
    w.providers.stripeInventory.mockImplementationOnce(async () => {
      order.push("verify");
      return { activeSubscriptions: 0, openInvoices: 0, pendingItems: 0, activeSchedules: 0, openCheckouts: 0 };
    });
    w.store.purgeBusiness.mockImplementationOnce(async () => {
      order.push("purge");
      w.state.db.rows = { client: 0, calls: 0, leads: 0, messages: 0, knowledge: 0, appointments: 0, users: 0, subscriptions: 0, other: 0 };
      return w.state.db.rows;
    });
    const res = await permanentDelete(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(true);
    expect(order).toEqual(["verify", "purge"]);
    expect(line(res, "Database")).toMatchObject({ text: "0 calls, 0 leads, 0 messages, 0 knowledge items, 0 users", zero: true });
    expect(res.message).toMatch(/Permanently deleted/);
    expect(res.action).toBe("permanent_delete");
  });

  it("does not touch the database when a vendor still holds something", async () => {
    const w = fullWorld();
    w.providers.retellDeleteAgent.mockImplementation(async () => "done"); // agent survives
    const res = await permanentDelete(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(false);
    expect(w.store.purgeBusiness).not.toHaveBeenCalled();
    expect(w.state.db.rows.calls).toBe(12);
    expect(st(res, "db_purge")).toEqual(["failed"]);
    // the attempt is audited WITH the business (so the operator can see what's left)
    expect(w.state.audits.at(-1)).toMatchObject({ action: "operator.permanent_delete_attempt", clientId: "c1" });
  });

  it("deletes Retell's own copies of the calls, and a call it can't delete never blocks the purge", async () => {
    const w = fullWorld();
    w.providers.retellDeleteCall.mockRejectedValueOnce(new Error("nope"));
    const res = await permanentDelete(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(true);
    expect(w.providers.retellDeleteCall).toHaveBeenCalledTimes(2);
    expect(w.state.vendor.calls).toEqual(["call_2"]);
    expect(st(res, "retell_calls")).toEqual(["skipped"]);
  });

  it("the only audit entry left names the business, the actor and the time, and nothing else", async () => {
    const w = fullWorld();
    await permanentDelete(w.deps, actor, "c1", opts);
    const receipt = w.state.audits.at(-1)!;
    expect(receipt.action).toBe("operator.permanent_delete");
    expect(receipt.clientId).toBeNull();
    expect(Object.keys(receipt.detail).sort()).toEqual(["at", "id", "name"]);
    expect(receipt.detail).toMatchObject({ id: "c1", name: "Bright Smile Dental" });
    expect(JSON.stringify(receipt)).not.toMatch(/@|\+1|sub_|agent_|llm_/);
    // and no step-by-step record that carries numbers or emails was written afterwards
    expect(w.state.audits.filter((a) => a.action.startsWith("operator.delete") || a.action.endsWith("_attempt"))).toHaveLength(0);
  });

  it("fails (and says so) if rows are still in the database after the purge", async () => {
    const w = fullWorld();
    w.store.purgeBusiness.mockImplementationOnce(async () => w.state.db.rows);
    const res = await permanentDelete(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(false);
    expect(line(res, "Database")?.zero).toBe(false);
    expect(w.state.audits.at(-1)?.action).toBe("operator.permanent_delete_attempt");
  });

  it("needs the typed name, and does nothing without it", async () => {
    const w = fullWorld();
    const res = await permanentDelete(w.deps, actor, "c1", { ...opts, confirm: "" });
    expect(res.httpStatus).toBe(400);
    expect(w.store.purgeBusiness).not.toHaveBeenCalled();
    expect(w.providers.stripeCancel).not.toHaveBeenCalled();
  });

  it("works on a company that was already soft-deleted", async () => {
    const w = fullWorld();
    w.state.client.deletedAt = new Date("2026-10-01T00:00:00Z");
    const res = await permanentDelete(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(true);
    expect(w.store.purgeBusiness).toHaveBeenCalledWith("c1", { agentId: "agent_1", phone: "+12272382281" });
  });

  it("404 for an unknown business", async () => {
    const w = fullWorld();
    w.store.getClient.mockResolvedValueOnce(null);
    expect((await permanentDelete(w.deps, actor, "nope", opts)).httpStatus).toBe(404);
  });

  it("the route accepts permanent_delete from an operator and carries the checklist back", async () => {
    const w = fullWorld();
    const req = new Request("http://x/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "permanent_delete", confirm: "Bright Smile Dental" }),
    });
    const res = await handleClientControl(req, "c1", { authorize: async () => ({ decision: { ok: true }, actor }), deps: () => w.deps });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; checklist: { zero: boolean }[] };
    expect(body.ok).toBe(true);
    expect(body.checklist.every((l) => l.zero)).toBe(true);
  });
});
