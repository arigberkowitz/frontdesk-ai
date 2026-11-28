import { describe, expect, it, vi } from "vitest";
import { deleteAgent, reactivateCompany, releaseNumber, releaseVoiceNumber, suspendCompany } from "./controls";
import { deleteCompany } from "./full-delete";
import { actor, makeWorld } from "./test-helpers";

const step = (res: { steps: { step: string; status: string }[] }, id: string) =>
  res.steps.filter((s) => s.step === id).map((s) => s.status);

describe("release phone number", () => {
  it("detaches, releases at Retell and Twilio, clears the DB pointer and holds auto-buy", async () => {
    const w = makeWorld({}, { tollfree: true });
    w.state.client.smsNumber = "+18885551234";
    const res = await releaseNumber(w.deps, actor, "c1");
    expect(res.ok).toBe(true);
    expect(w.providers.retellUnbindNumber).toHaveBeenCalledWith("+12272382281");
    expect(w.providers.retellReleaseNumber).toHaveBeenCalledWith("+12272382281");
    expect(w.providers.twilioReleaseNumber).toHaveBeenCalledWith("PN1");
    expect(w.state.client.retellPhoneNumber).toBeNull();
    expect(w.state.client.smsNumber).toBeNull();
    expect(w.state.tf).toBeNull();
    expect(w.state.client.setupFlags?.operatorNumberHoldAt).toBeTruthy();
    expect(w.state.audits.at(-1)).toMatchObject({ action: "operator.release_number", clientId: "c1" });
    // never touched billing or the agent
    expect(w.providers.stripeCancel).not.toHaveBeenCalled();
    expect(w.providers.retellDeleteAgent).not.toHaveBeenCalled();
  });

  it("leaves an operator-pasted SMS number alone", async () => {
    const w = makeWorld({ smsNumber: "+15125550000" }, { tollfree: true });
    await releaseNumber(w.deps, actor, "c1");
    expect(w.state.client.smsNumber).toBe("+15125550000");
  });

  it("treats a number already gone at Retell as success", async () => {
    const w = makeWorld();
    w.providers.retellReleaseNumber.mockResolvedValueOnce("already_gone");
    const res = await releaseNumber(w.deps, actor, "c1");
    expect(res.ok).toBe(true);
    expect(step(res, "retell_number")).toEqual(["already_gone"]);
    expect(w.state.client.retellPhoneNumber).toBeNull();
  });

  it("is idempotent: a second run does nothing at the vendors", async () => {
    const w = makeWorld({}, { tollfree: true });
    await releaseNumber(w.deps, actor, "c1");
    w.providers.retellReleaseNumber.mockClear();
    w.providers.twilioReleaseNumber.mockClear();
    const again = await releaseNumber(w.deps, actor, "c1");
    expect(again.ok).toBe(true);
    expect(w.providers.retellReleaseNumber).not.toHaveBeenCalled();
    expect(w.providers.twilioReleaseNumber).not.toHaveBeenCalled();
    expect(step(again, "retell_number")).toEqual(["skipped"]);
  });

  it("partial failure: keeps the pointer for the failed number, names the step, and Retry finishes", async () => {
    const w = makeWorld({}, { tollfree: true });
    w.providers.twilioReleaseNumber.mockRejectedValueOnce(new Error("Twilio 500"));
    const res = await releaseNumber(w.deps, actor, "c1");
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(502);
    expect(res.failedSteps).toEqual(["twilio_number"]);
    expect(step(res, "retell_number")).toEqual(["done"]);
    // Retell number is gone and cleared; the Twilio number is STILL pointed at, never orphaned.
    expect(w.state.client.retellPhoneNumber).toBeNull();
    expect(w.state.tf?.phoneNumberSid).toBe("PN1");

    const retry = await releaseNumber(w.deps, actor, "c1");
    expect(retry.ok).toBe(true);
    expect(w.state.tf).toBeNull();
    expect(w.providers.retellReleaseNumber).toHaveBeenCalledTimes(1);
  });

  it("a failed Retell release keeps the number in the DB so it is never orphaned", async () => {
    const w = makeWorld();
    w.providers.retellReleaseNumber.mockRejectedValueOnce(new Error("boom"));
    const res = await releaseNumber(w.deps, actor, "c1");
    expect(res.failedSteps).toEqual(["retell_number"]);
    expect(w.state.client.retellPhoneNumber).toBe("+12272382281");
  });

  it("fails loudly (and clears nothing) when Retell isn't configured", async () => {
    const w = makeWorld();
    w.providers.configured.retell = false;
    const res = await releaseNumber(w.deps, actor, "c1");
    expect(res.ok).toBe(false);
    expect(w.providers.retellReleaseNumber).not.toHaveBeenCalled();
    expect(w.state.client.retellPhoneNumber).toBe("+12272382281");
  });

  it("a detach error alone does not stop the release", async () => {
    const w = makeWorld();
    w.providers.retellUnbindNumber.mockRejectedValueOnce(new Error("detach failed"));
    const res = await releaseNumber(w.deps, actor, "c1");
    expect(res.ok).toBe(true);
    expect(w.providers.retellReleaseNumber).toHaveBeenCalled();
  });

  it("404 for an unknown business", async () => {
    const w = makeWorld();
    w.store.getClient = vi.fn(async () => null);
    expect((await releaseNumber(w.deps, actor, "nope")).httpStatus).toBe(404);
  });
});

describe("Delete number (voice number only, on the AI agent card)", () => {
  it("releases only the Retell number: agent, LLM and texting number stay; auto-buy held; audited", async () => {
    const w = makeWorld({}, { tollfree: true });
    const res = await releaseVoiceNumber(w.deps, actor, "c1");
    expect(res.ok).toBe(true);
    expect(w.providers.retellReleaseNumber).toHaveBeenCalledWith("+12272382281");
    expect(w.state.client.retellPhoneNumber).toBeNull();
    expect(w.state.client.retellAgentId).toBeTruthy(); // browser test calls need only the agent
    expect(w.state.client.retellLlmId).toBeTruthy();
    expect(w.providers.retellDeleteAgent).not.toHaveBeenCalled();
    expect(w.providers.retellDeleteLlm).not.toHaveBeenCalled();
    expect(w.providers.twilioReleaseNumber).not.toHaveBeenCalled();
    expect(w.state.tf).not.toBeNull();
    expect(w.providers.stripeCancel).not.toHaveBeenCalled();
    expect(w.state.client.setupFlags?.operatorNumberHoldAt).toBeTruthy();
    expect(w.state.audits.at(-1)).toMatchObject({ action: "operator.release_voice_number", clientId: "c1" });
  });

  it("is idempotent: a second press (or a number already gone at Retell) is success", async () => {
    const w = makeWorld();
    await releaseVoiceNumber(w.deps, actor, "c1");
    const again = await releaseVoiceNumber(w.deps, actor, "c1");
    expect(again.ok).toBe(true);
    expect(step(again, "retell_number")).toEqual(["skipped"]);
    expect(w.providers.retellReleaseNumber).toHaveBeenCalledTimes(1);
  });

  it("a Retell failure keeps the DB pointer (still billing, still listed) and the hold; Retry finishes it", async () => {
    const w = makeWorld();
    w.providers.retellReleaseNumber.mockRejectedValueOnce(new Error("Retell down"));
    const bad = await releaseVoiceNumber(w.deps, actor, "c1");
    expect(bad.ok).toBe(false);
    expect(w.state.client.retellPhoneNumber).toBe("+12272382281");
    expect(w.state.client.setupFlags?.operatorNumberHoldAt).toBeTruthy();
    const good = await releaseVoiceNumber(w.deps, actor, "c1");
    expect(good.ok).toBe(true);
    expect(w.state.client.retellPhoneNumber).toBeNull();
  });
});

describe("delete agent", () => {
  it("deletes the agent then its LLM and clears both ids", async () => {
    const w = makeWorld();
    const res = await deleteAgent(w.deps, actor, "c1");
    expect(res.ok).toBe(true);
    expect(w.providers.retellDeleteAgent).toHaveBeenCalledWith("agent_1");
    expect(w.providers.retellDeleteLlm).toHaveBeenCalledWith("llm_1");
    expect(w.providers.retellDeleteAgent.mock.invocationCallOrder[0]).toBeLessThan(
      w.providers.retellDeleteLlm.mock.invocationCallOrder[0],
    );
    expect(w.state.client.retellAgentId).toBeNull();
    expect(w.state.client.retellLlmId).toBeNull();
    // detaches the number so it isn't left dangling, but does not release it
    expect(w.providers.retellUnbindNumber).toHaveBeenCalled();
    expect(w.providers.retellReleaseNumber).not.toHaveBeenCalled();
  });

  it("if the agent delete fails, the LLM is not touched and Retry completes", async () => {
    const w = makeWorld();
    w.providers.retellDeleteAgent.mockRejectedValueOnce(new Error("busy"));
    const res = await deleteAgent(w.deps, actor, "c1");
    expect(res.ok).toBe(false);
    expect(res.failedSteps).toEqual(["retell_agent", "retell_llm"]);
    expect(w.providers.retellDeleteLlm).not.toHaveBeenCalled();
    expect(w.state.client.retellAgentId).toBe("agent_1");
    expect((await deleteAgent(w.deps, actor, "c1")).ok).toBe(true);
    expect(w.state.client.retellLlmId).toBeNull();
  });

  it("agent already gone at Retell counts as success; idempotent afterwards", async () => {
    const w = makeWorld();
    w.providers.retellDeleteAgent.mockResolvedValueOnce("already_gone");
    w.providers.retellDeleteLlm.mockResolvedValueOnce("already_gone");
    const res = await deleteAgent(w.deps, actor, "c1");
    expect(res.ok).toBe(true);
    expect(step(res, "retell_agent")).toEqual(["already_gone"]);
    const again = await deleteAgent(w.deps, actor, "c1");
    expect(again.ok).toBe(true);
    expect(step(again, "retell_agent")).toEqual(["skipped"]);
    expect(w.providers.retellDeleteAgent).toHaveBeenCalledTimes(1);
  });
});

describe("suspend / reactivate", () => {
  it("locks first, detaches the line, drops queued texts and cancels Stripe with no refund by default", async () => {
    const w = makeWorld();
    const res = await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "cancel" });
    expect(res.ok).toBe(true);
    expect(w.state.client.status).toBe("paused");
    expect(w.state.client.setupFlags?.suspended).toMatchObject({ mode: "off", previousStatus: "live", by: "user_ari", stripe: { action: "cancel", prorate: false } });
    expect(w.providers.retellUnbindNumber).toHaveBeenCalledWith("+12272382281");
    expect(w.providers.stripeCancel).toHaveBeenCalledWith("sub_1", { prorate: false });
    expect(w.state.queued).toBe(0);
    expect(w.state.sub?.status).toBe("canceled");
    // reversible: number and agent are kept
    expect(w.providers.retellReleaseNumber).not.toHaveBeenCalled();
    expect(w.providers.retellDeleteAgent).not.toHaveBeenCalled();
    expect(w.state.audits.at(-1)?.action).toBe("operator.suspend");
  });

  it("the DB lock lands even when every vendor call fails", async () => {
    const w = makeWorld();
    w.providers.retellUnbindNumber.mockRejectedValue(new Error("down"));
    w.providers.stripeCancel.mockRejectedValue(new Error("down"));
    const res = await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "cancel" });
    expect(res.ok).toBe(false);
    expect(res.failedSteps).toEqual(["line", "stripe"]);
    expect(w.state.client.status).toBe("paused");
    expect(w.state.client.setupFlags?.suspended).toBeTruthy();
  });

  it("proration is opt-in", async () => {
    const w = makeWorld();
    await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "cancel", prorate: true });
    expect(w.providers.stripeCancel).toHaveBeenCalledWith("sub_1", { prorate: true });
  });

  it("messages-only republishes the agent instead of detaching the line", async () => {
    const w = makeWorld();
    await suspendCompany(w.deps, actor, "c1", { mode: "messages_only", stripe: "none" });
    expect(w.providers.republishAgent).toHaveBeenCalledWith("org1", "c1");
    expect(w.providers.retellUnbindNumber).not.toHaveBeenCalled();
    expect(w.providers.stripeCancel).not.toHaveBeenCalled();
  });

  it("pause leaves the subscription resumable", async () => {
    const w = makeWorld();
    await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "pause" });
    expect(w.providers.stripePause).toHaveBeenCalledWith("sub_1");
    expect(w.providers.stripeCancel).not.toHaveBeenCalled();
  });

  it("cancels other open subscriptions on the same customer too", async () => {
    const w = makeWorld();
    w.providers.stripeOpenSubscriptionsFor.mockResolvedValueOnce(["sub_1", "sub_dup"]);
    await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "cancel" });
    expect(w.providers.stripeCancel).toHaveBeenCalledTimes(2);
  });

  it("retrying a suspend keeps the ORIGINAL previous status (not 'paused')", async () => {
    const w = makeWorld({ status: "trial" });
    await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "none" });
    await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "none" });
    expect(w.state.client.setupFlags?.suspended?.previousStatus).toBe("trial");
  });

  it("stripe already canceled is success", async () => {
    const w = makeWorld();
    w.providers.stripeCancel.mockResolvedValue("already_gone");
    const res = await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "cancel" });
    expect(res.ok).toBe(true);
    expect(step(res, "stripe")).toEqual(["already_gone"]);
  });

  it("reactivate restores status and rebinds the line", async () => {
    const w = makeWorld({ status: "live" });
    await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "none" });
    const res = await reactivateCompany(w.deps, actor, "c1");
    expect(res.ok).toBe(true);
    expect(w.providers.retellRebindNumber).toHaveBeenCalledWith("+12272382281", "agent_1");
    expect(w.state.client.status).toBe("live");
    expect(w.state.client.setupFlags?.suspended).toBeUndefined();
  });

  it("reactivate resumes a paused subscription, and says a canceled one can't come back", async () => {
    const paused = makeWorld();
    await suspendCompany(paused.deps, actor, "c1", { mode: "off", stripe: "pause" });
    await reactivateCompany(paused.deps, actor, "c1");
    expect(paused.providers.stripeResume).toHaveBeenCalledWith("sub_1");

    const canceled = makeWorld();
    await suspendCompany(canceled.deps, actor, "c1", { mode: "off", stripe: "cancel" });
    const res = await reactivateCompany(canceled.deps, actor, "c1");
    expect(res.ok).toBe(true);
    expect(canceled.providers.stripeResume).not.toHaveBeenCalled();
    expect(res.steps.find((s) => s.step === "stripe")?.detail).toMatch(/pick a plan again/);
  });

  it("a failed rebind keeps the company suspended so Retry has a clear job", async () => {
    const w = makeWorld();
    await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "none" });
    w.providers.retellRebindNumber.mockRejectedValueOnce(new Error("nope"));
    const res = await reactivateCompany(w.deps, actor, "c1");
    expect(res.ok).toBe(false);
    expect(w.state.client.setupFlags?.suspended).toBeTruthy();
    expect(w.state.client.status).toBe("paused");
    expect((await reactivateCompany(w.deps, actor, "c1")).ok).toBe(true);
    expect(w.state.client.status).toBe("live");
  });

  it("reactivating a company that isn't suspended is a harmless no-op", async () => {
    const w = makeWorld();
    const res = await reactivateCompany(w.deps, actor, "c1");
    expect(res.ok).toBe(true);
    expect(res.steps).toEqual([]);
  });

  it("an owner's own pause stays a pause after reactivate", async () => {
    const w = makeWorld({ status: "paused" });
    await suspendCompany(w.deps, actor, "c1", { mode: "off", stripe: "none" });
    await reactivateCompany(w.deps, actor, "c1");
    expect(w.state.client.status).toBe("paused");
  });
});

describe("delete company", () => {
  const opts = { confirm: "Bright Smile Dental", blockFraud: false };

  it("requires the exact business name (case-insensitive) and does nothing otherwise", async () => {
    const w = makeWorld();
    const res = await deleteCompany(w.deps, actor, "c1", { ...opts, confirm: "bright smile" });
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(400);
    expect(w.providers.retellReleaseNumber).not.toHaveBeenCalled();
    expect(w.providers.stripeCancel).not.toHaveBeenCalled();
    expect(w.state.client.deletedAt).toBeNull();
    const ok = await deleteCompany(w.deps, actor, "c1", { ...opts, confirm: "  bright SMILE dental " });
    expect(ok.ok).toBe(true);
  });

  it("releases numbers, deletes agent + LLM, cancels Stripe (no refund) and soft-deletes", async () => {
    const w = makeWorld({}, { tollfree: true });
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(true);
    expect(w.providers.retellReleaseNumber).toHaveBeenCalled();
    expect(w.providers.twilioReleaseNumber).toHaveBeenCalledWith("PN1");
    expect(w.providers.retellDeleteAgent).toHaveBeenCalledWith("agent_1");
    expect(w.providers.retellDeleteLlm).toHaveBeenCalledWith("llm_1");
    expect(w.providers.stripeCancel).toHaveBeenCalledWith("sub_1", { prorate: false });
    expect(w.state.client.deletedAt).toEqual(new Date("2026-11-27T12:00:00Z"));
    expect(w.state.client.retellPhoneNumber).toBeNull();
    expect(w.state.client.retellAgentId).toBeNull();
    expect(w.state.client.setupFlags?.suspended?.deleting).toBe(true);
    expect(w.state.work.queuedTexts).toBe(0);
    // subscription row is kept (billing/legal), only its status changes
    expect(w.state.sub).toBeTruthy();
    const audit = w.state.audits.at(-1)!;
    expect(audit.action).toBe("operator.delete_company");
    expect(audit.detail).toMatchObject({ ids: { phone: "+12272382281", agentId: "agent_1", llmId: "llm_1" }, by: "ari@example.com" });
  });

  it("on a partial failure the company stays locked and LISTED (not soft-deleted) and names the failed step", async () => {
    const w = makeWorld();
    w.providers.stripeCancel.mockRejectedValueOnce(new Error("Stripe 500"));
    const res = await deleteCompany(w.deps, actor, "c1", opts);
    expect(res.ok).toBe(false);
    expect(res.failedSteps).toContain("stripe");
    expect(res.failedSteps).toContain("soft_delete");
    expect(w.state.client.deletedAt).toBeNull();
    expect(w.state.client.status).toBe("paused");
    // number and agent are already released, so nothing is left billing orphaned
    expect(w.state.client.retellPhoneNumber).toBeNull();
    expect(w.state.client.retellAgentId).toBeNull();
    const retry = await deleteCompany(w.deps, actor, "c1", opts);
    expect(retry.ok).toBe(true);
    expect(w.state.client.deletedAt).toBeTruthy();
    expect(w.providers.retellReleaseNumber).toHaveBeenCalledTimes(1);
    expect(w.providers.retellDeleteAgent).toHaveBeenCalledTimes(1);
  });

  it("is idempotent once deleted", async () => {
    const w = makeWorld();
    await deleteCompany(w.deps, actor, "c1", opts);
    w.providers.stripeCancel.mockClear();
    const again = await deleteCompany(w.deps, actor, "c1", opts);
    // A second press re-checks the vendors (a business closed by its owner can still hold a number)
    // but has nothing left to cancel, release or delete.
    expect(again.ok).toBe(true);
    expect(w.providers.stripeCancel).not.toHaveBeenCalled();
    expect(w.providers.retellReleaseNumber).toHaveBeenCalledTimes(1);
    expect(again.checklist?.every((l) => l.zero)).toBe(true);
  });

  it("a deleting company cannot be reactivated", async () => {
    const w = makeWorld();
    w.providers.stripeCancel.mockRejectedValueOnce(new Error("x"));
    await deleteCompany(w.deps, actor, "c1", opts);
    const res = await reactivateCompany(w.deps, actor, "c1");
    expect(res.ok).toBe(false);
    expect(res.httpStatus).toBe(409);
  });

  it("fraud flag records customer identities (never the operator) and not free-mail domains", async () => {
    const w = makeWorld();
    await deleteCompany(w.deps, actor, "c1", { ...opts, blockFraud: true });
    expect(w.state.blocks).toHaveLength(1);
    expect(w.state.blocks[0]).toEqual({
      emails: ["pat@brightsmile.example", "owner2@brightsmile.example"],
      phones: ["4155550100"],
      domain: "brightsmile.example",
    });
  });

  it("fraud flag skips a free-mail domain", async () => {
    const w = makeWorld({ ownerEmail: "scammer@gmail.com" });
    w.store.identitiesFor = vi.fn(async () => ({ emails: [] as string[], phones: [] as string[] }));
    await deleteCompany(w.deps, actor, "c1", { ...opts, blockFraud: true });
    expect(w.state.blocks[0]).toEqual({ emails: ["scammer@gmail.com"], phones: [], domain: null });
  });

  it("a fraud flag that fails to save fails the delete (it must not silently not-save)", async () => {
    const w = makeWorld();
    w.store.writeTrialBlock = vi.fn(async () => {
      throw new Error("db down");
    });
    const res = await deleteCompany(w.deps, actor, "c1", { ...opts, blockFraud: true });
    expect(res.ok).toBe(false);
    expect(res.failedSteps).toContain("fraud_flag");
    expect(w.state.client.deletedAt).toBeNull();
  });

  it("no fraud flag unless asked", async () => {
    const w = makeWorld();
    await deleteCompany(w.deps, actor, "c1", opts);
    expect(w.state.blocks).toHaveLength(0);
  });
});
