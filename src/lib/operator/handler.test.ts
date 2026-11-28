import { describe, expect, it, vi } from "vitest";
import { decideOperatorAccess } from "./access";
import { handleClientControl, handleOrphanDelete, handleOrphansList, type Authorize } from "./handler";
import { actor, makeWorld } from "./test-helpers";

const json = (body: unknown, type = "application/json") =>
  new Request("http://x/api", { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });

const allow: Authorize = async () => ({ decision: { ok: true }, actor });
const forbid: Authorize = async () => ({ decision: { ok: false, status: 403, error: "Operator only." } });
const signedOut: Authorize = async () => ({ decision: { ok: false, status: 401, error: "Sign in required." } });

describe("decideOperatorAccess", () => {
  const op = { role: "operator" as const, orgId: "org1" };
  it("signed-out → 401", () => {
    expect(decideOperatorAccess({ user: null, superAdmin: false, orgKind: null, targetOrgId: "org1" }, "client")).toMatchObject({ ok: false, status: 401 });
  });
  it.each(["client_admin", "client_viewer"] as const)("%s → 403, even in their own org", (role) => {
    expect(decideOperatorAccess({ user: { role, orgId: "org1" }, superAdmin: false, orgKind: "agency", targetOrgId: "org1" }, "client")).toMatchObject({ ok: false, status: 403 });
  });
  it("an operator of a self-serve (non-agency) workspace → 403", () => {
    expect(decideOperatorAccess({ user: op, superAdmin: false, orgKind: "business", targetOrgId: "org1" }, "client")).toMatchObject({ ok: false, status: 403 });
  });
  it("an agency operator may act on their own org's business only", () => {
    expect(decideOperatorAccess({ user: op, superAdmin: false, orgKind: "agency", targetOrgId: "org1" }, "client")).toEqual({ ok: true });
    expect(decideOperatorAccess({ user: op, superAdmin: false, orgKind: "agency", targetOrgId: "other" }, "client")).toMatchObject({ ok: false, status: 403 });
    expect(decideOperatorAccess({ user: op, superAdmin: false, orgKind: "agency", targetOrgId: null }, "client")).toMatchObject({ ok: false, status: 403 });
  });
  it("platform-wide controls (orphans) are the super-admin's alone", () => {
    expect(decideOperatorAccess({ user: op, superAdmin: false, orgKind: "agency", targetOrgId: null }, "platform")).toMatchObject({ ok: false, status: 403 });
    expect(decideOperatorAccess({ user: op, superAdmin: true, orgKind: "agency", targetOrgId: null }, "platform")).toEqual({ ok: true });
  });
});

describe("client control route handler", () => {
  it("a non-operator gets 403 and NOTHING is called at any vendor or the database", async () => {
    const w = makeWorld();
    for (const action of ["release_number", "release_voice_number", "delete_agent", "suspend", "reactivate", "delete_company", "permanent_delete"]) {
      const res = await handleClientControl(json({ action, confirm: "Bright Smile Dental" }), "c1", { authorize: forbid, deps: () => w.deps });
      expect(res.status).toBe(403);
    }
    for (const fn of Object.values(w.providers)) if (typeof fn === "function") expect(fn).not.toHaveBeenCalled();
    expect(w.store.getClient).not.toHaveBeenCalled();
    expect(w.store.patchClient).not.toHaveBeenCalled();
  });

  it("release_voice_number runs for an operator and leaves the agent alone", async () => {
    const w = makeWorld();
    const res = await handleClientControl(json({ action: "release_voice_number" }), "c1", { authorize: allow, deps: () => w.deps });
    expect(res.status).toBe(200);
    expect(w.providers.retellReleaseNumber).toHaveBeenCalled();
    expect(w.providers.retellDeleteAgent).not.toHaveBeenCalled();
  });

  it("signed out → 401", async () => {
    const w = makeWorld();
    const res = await handleClientControl(json({ action: "release_number" }), "c1", { authorize: signedOut, deps: () => w.deps });
    expect(res.status).toBe(401);
  });

  it("rejects non-JSON posts (CSRF) and bad bodies", async () => {
    const w = makeWorld();
    expect((await handleClientControl(json({ action: "release_number" }, "application/x-www-form-urlencoded"), "c1", { authorize: allow, deps: () => w.deps })).status).toBe(415);
    expect((await handleClientControl(json({ action: "nuke" }), "c1", { authorize: allow, deps: () => w.deps })).status).toBe(400);
    expect(w.providers.retellReleaseNumber).not.toHaveBeenCalled();
  });

  it("runs the action for an authorized operator and returns the step list", async () => {
    const w = makeWorld();
    const res = await handleClientControl(json({ action: "release_number" }), "c1", { authorize: allow, deps: () => w.deps });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.steps.map((s: { step: string }) => s.step)).toContain("retell_number");
    expect(w.providers.retellReleaseNumber).toHaveBeenCalled();
  });

  it("a partial failure answers 502 with the failed step so the UI can offer Retry", async () => {
    const w = makeWorld();
    w.providers.retellReleaseNumber.mockRejectedValueOnce(new Error("boom"));
    const res = await handleClientControl(json({ action: "release_number" }), "c1", { authorize: allow, deps: () => w.deps });
    expect(res.status).toBe(502);
    expect((await res.json()).failedSteps).toEqual(["retell_number"]);
  });

  it("delete_company with the wrong typed name is a 400 and changes nothing", async () => {
    const w = makeWorld();
    const res = await handleClientControl(json({ action: "delete_company", confirm: "nope" }), "c1", { authorize: allow, deps: () => w.deps });
    expect(res.status).toBe(400);
    expect(w.providers.retellReleaseNumber).not.toHaveBeenCalled();
  });

  it("suspend defaults are the safe ones: line off, Stripe cancel, no proration", async () => {
    const w = makeWorld();
    await handleClientControl(json({ action: "suspend" }), "c1", { authorize: allow, deps: () => w.deps });
    expect(w.providers.retellUnbindNumber).toHaveBeenCalled();
    expect(w.providers.stripeCancel).toHaveBeenCalledWith("sub_1", { prorate: false });
  });
});

describe("orphan route handlers", () => {
  const deps = () => ({
    providers: { configured: { retell: false, stripe: false, twilio: false } } as never,
    store: { activeHoldings: vi.fn(), audit: vi.fn() } as never,
  });
  it("list and delete are 403 for a non-platform-owner", async () => {
    expect((await handleOrphansList({ authorize: forbid, deps })).status).toBe(403);
    expect((await handleOrphanDelete(json({ kind: "retell_agent", id: "a" }), { authorize: forbid, deps })).status).toBe(403);
  });
  it("delete validates its body", async () => {
    expect((await handleOrphanDelete(json({ kind: "everything", id: "a" }), { authorize: allow, deps })).status).toBe(400);
  });
});
