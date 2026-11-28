import { confirmationMatches } from "@/lib/account-close";
import type { SuspendedFlag } from "./suspension";
import { identityFrom, type BlockedIdentity } from "./trial-block";

/**
 * The operator's own controls over a business: release its phone number,
 * delete its agent, suspend it, delete it.
 *
 * Everything vendor-facing goes through `OperatorProviders` and everything
 * database-facing through `ControlStore`, so each step is unit-tested with
 * mocks and nothing here can reach Retell / Twilio / Stripe on its own.
 *
 * Rules every step follows:
 *  - Idempotent. A resource the vendor says is already gone is a success, and a
 *    step whose database pointer is already cleared is skipped. Pressing Retry
 *    after a partial failure re-runs the whole action safely.
 *  - The database pointer to a vendor resource is cleared only AFTER the vendor
 *    confirms the release. A number that failed to release keeps its pointer, so
 *    it is still listed against the business (never "billing but orphaned"), and
 *    Retry knows exactly what is left.
 *  - A failure is reported by step, never swallowed and never thrown at the UI.
 */

export type Outcome = "done" | "already_gone";

export interface OperatorProviders {
  configured: { retell: boolean; stripe: boolean; twilio: boolean };
  /** Detach a number from its agent. Number stays bought. */
  retellUnbindNumber(phone: string): Promise<Outcome>;
  /** Point a number back at an agent. */
  retellRebindNumber(phone: string, agentId: string): Promise<Outcome>;
  /** Release (delete) a Retell-purchased number: stops its monthly billing. */
  retellReleaseNumber(phone: string): Promise<Outcome>;
  retellDeleteAgent(agentId: string): Promise<Outcome>;
  retellDeleteLlm(llmId: string): Promise<Outcome>;
  /** Release a Twilio number we bought (the toll-free texting number). */
  twilioReleaseNumber(sid: string): Promise<Outcome>;
  /**
   * Cancel a subscription immediately. `prorate` false = no credit for unused
   * time and no final invoice: the customer is simply never billed again.
   */
  stripeCancel(subscriptionId: string, opts: { prorate: boolean }): Promise<Outcome>;
  /** Other not-yet-canceled subscriptions on the same Stripe customer. */
  stripeOpenSubscriptionsFor(customerId: string): Promise<string[]>;
  /** Stop collecting payment, keep the subscription so it can resume. */
  stripePause(subscriptionId: string): Promise<Outcome>;
  /** "resumed", or "canceled" when it can no longer be resumed. */
  stripeResume(subscriptionId: string): Promise<"resumed" | "canceled" | "not_paused">;
  /** Rebuild the live agent from the DB (messages-only / full prompt). */
  republishAgent(orgId: string, clientId: string): Promise<void>;
}

export interface ControlClient {
  id: string;
  orgId: string;
  name: string;
  status: SuspendedFlag["previousStatus"];
  deletedAt: Date | null;
  retellAgentId: string | null;
  retellLlmId: string | null;
  retellPhoneNumber: string | null;
  smsNumber: string | null;
  ownerEmail: string | null;
  setupFlags: {
    suspended?: SuspendedFlag;
    operatorNumberHoldAt?: string;
    [k: string]: unknown;
  } | null;
}

export interface ControlSubscription {
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  status: string | null;
}

export interface ClientPatch {
  status?: SuspendedFlag["previousStatus"];
  retellAgentId?: null;
  retellLlmId?: null;
  retellPhoneNumber?: null;
  smsNumber?: null;
  deletedAt?: Date;
}

export interface ControlStore {
  getClient(clientId: string): Promise<ControlClient | null>;
  patchClient(clientId: string, patch: ClientPatch): Promise<void>;
  /** Atomic jsonb merge on setup_flags: set keys, remove keys. */
  mergeFlags(clientId: string, set: Record<string, unknown>, remove?: string[]): Promise<void>;
  getSubscription(clientId: string): Promise<ControlSubscription | null>;
  markSubscriptionStatus(clientId: string, status: "canceled" | "paused" | "active"): Promise<void>;
  getTollfree(clientId: string): Promise<{ phoneNumber: string | null; phoneNumberSid: string | null } | null>;
  clearTollfree(clientId: string): Promise<void>;
  /** Mark queued customer texts for the business as dropped; returns how many. */
  dropQueuedTexts(clientId: string): Promise<number>;
  /** Customer-side identities (owner email / cell, domain) — never the operator's own. */
  identitiesFor(clientId: string): Promise<{ emails: string[]; phones: string[] }>;
  isFreeEmailDomain(domain: string): boolean;
  /** Must throw on failure: a fraud flag that silently didn't save is worse than none. */
  writeTrialBlock(clientId: string, identity: BlockedIdentity, detail: Record<string, unknown>): Promise<void>;
  audit(entry: { clientId: string | null; actor: string; action: string; detail: Record<string, unknown> }): Promise<void>;
}

export interface ControlDeps {
  providers: OperatorProviders;
  store: ControlStore;
  now?: () => Date;
}

export interface Actor {
  id: string;
  email: string;
}

export type StepId =
  | "lock"
  | "hold_auto_buy"
  | "retell_number"
  | "twilio_number"
  | "retell_agent"
  | "retell_llm"
  | "line"
  | "stripe"
  | "queued_texts"
  | "fraud_flag"
  | "soft_delete"
  | "unsuspend";

export interface StepResult {
  step: StepId;
  label: string;
  status: "done" | "already_gone" | "skipped" | "failed";
  detail?: string;
  error?: string;
}

export type ControlAction = "release_number" | "release_voice_number" | "delete_agent" | "suspend" | "reactivate" | "delete_company";

export interface ControlResult {
  ok: boolean;
  action: ControlAction;
  /** HTTP status the route should answer with. */
  httpStatus: 200 | 400 | 404 | 409 | 502;
  message: string;
  steps: StepResult[];
  failedSteps: StepId[];
}

function errMsg(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  // Vendor messages can name accounts and keys; the operator needs the gist, not a paragraph.
  return m.replace(/\s+/g, " ").slice(0, 240);
}

async function step(
  steps: StepResult[],
  id: StepId,
  label: string,
  run: () => Promise<Partial<Omit<StepResult, "step" | "label">> | void>,
): Promise<boolean> {
  try {
    const r = await run();
    steps.push({ step: id, label, status: "done", ...(r ?? {}) });
    return true;
  } catch (err) {
    steps.push({ step: id, label, status: "failed", error: errMsg(err) });
    return false;
  }
}

function finish(action: ControlAction, steps: StepResult[], okMessage: string, failMessage?: string): ControlResult {
  const failedSteps = steps.filter((s) => s.status === "failed").map((s) => s.step);
  const ok = failedSteps.length === 0;
  return {
    ok,
    action,
    httpStatus: ok ? 200 : 502,
    message: ok
      ? okMessage
      : (failMessage ??
        `${failedSteps.length === 1 ? "One step" : `${failedSteps.length} steps`} didn't finish. Nothing was lost — press Retry and only what's left will run.`),
    steps,
    failedSteps,
  };
}

const notFound = (action: ControlAction): ControlResult => ({
  ok: false,
  action,
  httpStatus: 404,
  message: "Business not found.",
  steps: [],
  failedSteps: [],
});

const nowOf = (deps: ControlDeps) => (deps.now?.() ?? new Date()).toISOString();

/* ------------------------------ step groups ------------------------------ */

/** Release the Retell number (after detaching it) and the Twilio texting number we bought. */
async function releaseNumberSteps(
  deps: ControlDeps,
  clientId: string,
  steps: StepResult[],
  opts: { voiceOnly?: boolean } = {},
): Promise<void> {
  const { providers: p, store } = deps;
  const client = (await store.getClient(clientId))!;

  // Stop the automatic buyers first, so nothing re-buys a number while (or
  // after) we release this one.
  await step(steps, "hold_auto_buy", "Stop automatic number buying", async () => {
    await store.mergeFlags(clientId, { operatorNumberHoldAt: nowOf(deps) });
  });

  const phone = client.retellPhoneNumber;
  if (!phone) {
    steps.push({ step: "retell_number", label: "Release phone number at Retell", status: "skipped", detail: "No phone number on file" });
  } else {
    await step(steps, "retell_number", `Release ${phone} at Retell`, async () => {
      if (!p.configured.retell) throw new Error("Retell isn't configured (no RETELL_API_KEY) — the number was NOT released");
      // Detach first so the AI stops answering even if the release itself fails.
      try {
        await p.retellUnbindNumber(phone);
      } catch {
        // Best effort: the release below is what actually matters.
      }
      const out = await p.retellReleaseNumber(phone);
      await store.patchClient(clientId, { retellPhoneNumber: null });
      return { status: out === "already_gone" ? "already_gone" : "done", detail: phone };
    });
  }

  if (opts.voiceOnly) return; // the texting number and the agent are left alone

  const tf = await store.getTollfree(clientId);
  if (!tf?.phoneNumberSid) {
    steps.push({ step: "twilio_number", label: "Release texting number at Twilio", status: "skipped", detail: "No texting number we bought" });
  } else {
    await step(steps, "twilio_number", `Release texting number ${tf.phoneNumber ?? tf.phoneNumberSid} at Twilio`, async () => {
      if (!p.configured.twilio) throw new Error("Twilio isn't configured — the texting number was NOT released");
      const out = await p.twilioReleaseNumber(tf.phoneNumberSid!);
      await store.clearTollfree(clientId);
      // Only unlink the business's SMS number when it IS the one we just released;
      // a number an operator pasted in by hand is theirs, not ours to touch.
      if (tf.phoneNumber && client.smsNumber === tf.phoneNumber) await store.patchClient(clientId, { smsNumber: null });
      return { status: out === "already_gone" ? "already_gone" : "done", detail: tf.phoneNumber ?? tf.phoneNumberSid! };
    });
  }
}

/** Delete the Retell agent, then its LLM, clearing the ids as each goes. */
async function deleteAgentSteps(deps: ControlDeps, clientId: string, steps: StepResult[]): Promise<void> {
  const { providers: p, store } = deps;
  const client = (await store.getClient(clientId))!;

  if (!client.retellAgentId && !client.retellLlmId) {
    steps.push({ step: "retell_agent", label: "Delete agent at Retell", status: "skipped", detail: "No agent on file" });
    return;
  }

  let agentGone = !client.retellAgentId;
  if (client.retellAgentId) {
    const agentId = client.retellAgentId;
    agentGone = await step(steps, "retell_agent", `Delete agent ${agentId} at Retell`, async () => {
      if (!p.configured.retell) throw new Error("Retell isn't configured (no RETELL_API_KEY) — the agent was NOT deleted");
      // A number still pointing at the agent would be left dangling; detach it.
      if (client.retellPhoneNumber) {
        try {
          await p.retellUnbindNumber(client.retellPhoneNumber);
        } catch {
          // Best effort.
        }
      }
      const out = await p.retellDeleteAgent(agentId);
      await store.patchClient(clientId, { retellAgentId: null });
      return { status: out === "already_gone" ? "already_gone" : "done", detail: agentId };
    });
  }

  if (client.retellLlmId) {
    const llmId = client.retellLlmId;
    if (!agentGone) {
      steps.push({
        step: "retell_llm",
        label: `Delete LLM ${llmId} at Retell`,
        status: "failed",
        error: "Not attempted: the agent still exists and uses it. Retry once the agent is deleted.",
      });
    } else {
      await step(steps, "retell_llm", `Delete LLM ${llmId} at Retell`, async () => {
        if (!p.configured.retell) throw new Error("Retell isn't configured (no RETELL_API_KEY) — the LLM was NOT deleted");
        const out = await p.retellDeleteLlm(llmId);
        await store.patchClient(clientId, { retellLlmId: null });
        return { status: out === "already_gone" ? "already_gone" : "done", detail: llmId };
      });
    }
  }
}

/** Stripe: cancel immediately (no refund) or pause, for the stored subscription and any other open ones. */
async function stripeSteps(
  deps: ControlDeps,
  clientId: string,
  mode: { action: "cancel" | "pause" | "none"; prorate: boolean },
  steps: StepResult[],
): Promise<void> {
  const { providers: p, store } = deps;
  if (mode.action === "none") {
    steps.push({ step: "stripe", label: "Stripe subscription", status: "skipped", detail: "Left as is" });
    return;
  }
  const sub = await store.getSubscription(clientId);
  if (!sub?.stripeSubscriptionId && !sub?.stripeCustomerId) {
    steps.push({ step: "stripe", label: "Stripe subscription", status: "skipped", detail: "No subscription on file" });
    return;
  }
  await step(steps, "stripe", mode.action === "cancel" ? "Cancel Stripe subscription now" : "Pause Stripe billing", async () => {
    if (!p.configured.stripe) throw new Error("Stripe isn't configured — the subscription was NOT changed; do it in the Stripe dashboard");
    const ids = new Set<string>();
    if (sub.stripeSubscriptionId) ids.add(sub.stripeSubscriptionId);
    if (sub.stripeCustomerId) for (const id of await p.stripeOpenSubscriptionsFor(sub.stripeCustomerId)) ids.add(id);
    if (ids.size === 0) return { status: "skipped", detail: "No open subscription" };
    let alreadyGone = 0;
    for (const id of ids) {
      const out = mode.action === "cancel" ? await p.stripeCancel(id, { prorate: mode.prorate }) : await p.stripePause(id);
      if (out === "already_gone") alreadyGone += 1;
    }
    await store.markSubscriptionStatus(clientId, mode.action === "cancel" ? "canceled" : "paused");
    return {
      status: alreadyGone === ids.size ? "already_gone" : "done",
      detail: `${[...ids].join(", ")}${mode.action === "cancel" ? (mode.prorate ? " · unused time credited" : " · no refund, no proration") : ""}`,
    };
  });
}

/* --------------------------------- actions -------------------------------- */

export async function releaseNumber(deps: ControlDeps, actor: Actor, clientId: string): Promise<ControlResult> {
  const client = await deps.store.getClient(clientId);
  if (!client) return notFound("release_number");
  const steps: StepResult[] = [];
  await releaseNumberSteps(deps, clientId, steps);
  const res = finish(
    "release_number",
    steps,
    "Phone number released. The AI no longer answers on it and the vendor stops billing for it.",
  );
  await deps.store.audit({
    clientId,
    actor: actor.id,
    action: "operator.release_number",
    detail: { by: actor.email, ok: res.ok, steps, phone: client.retellPhoneNumber },
  });
  return res;
}

/**
 * Release ONLY the Retell voice number (the $2/mo line). The agent, its LLM and
 * the texting number stay, so browser test calls keep working. Automatic
 * number-buying is held so the call_ended webhook doesn't buy a replacement;
 * an operator who re-provisions a first number clears the hold.
 */
export async function releaseVoiceNumber(deps: ControlDeps, actor: Actor, clientId: string): Promise<ControlResult> {
  const client = await deps.store.getClient(clientId);
  if (!client) return notFound("release_voice_number");
  const steps: StepResult[] = [];
  await releaseNumberSteps(deps, clientId, steps, { voiceOnly: true });
  const res = finish(
    "release_voice_number",
    steps,
    "Number released. It stops billing, nothing will buy a new one on its own, and the agent is untouched for browser test calls.",
  );
  await deps.store.audit({
    clientId,
    actor: actor.id,
    action: "operator.release_voice_number",
    detail: { by: actor.email, ok: res.ok, steps, phone: client.retellPhoneNumber, agentId: client.retellAgentId },
  });
  return res;
}

export async function deleteAgent(deps: ControlDeps, actor: Actor, clientId: string): Promise<ControlResult> {
  const client = await deps.store.getClient(clientId);
  if (!client) return notFound("delete_agent");
  const steps: StepResult[] = [];
  await deleteAgentSteps(deps, clientId, steps);
  const res = finish("delete_agent", steps, "Agent deleted at Retell. The ids are cleared here too.");
  await deps.store.audit({
    clientId,
    actor: actor.id,
    action: "operator.delete_agent",
    detail: { by: actor.email, ok: res.ok, steps, agentId: client.retellAgentId, llmId: client.retellLlmId },
  });
  return res;
}

export interface SuspendOptions {
  mode: "off" | "messages_only";
  stripe: "cancel" | "pause" | "none";
  /** Credit unused time on cancel. Default false: no refund, no proration. */
  prorate?: boolean;
  reason?: string;
}

export async function suspendCompany(
  deps: ControlDeps,
  actor: Actor,
  clientId: string,
  opts: SuspendOptions,
): Promise<ControlResult> {
  const { providers: p, store } = deps;
  const client = await store.getClient(clientId);
  if (!client || client.deletedAt) return notFound("suspend");
  const steps: StepResult[] = [];
  const prorate = Boolean(opts.prorate);
  const existing = client.setupFlags?.suspended;

  // 1. Flip the switch FIRST, in our own database. Whatever a vendor does or
  //    doesn't do next, this business is now out of every job and the portal.
  //    A retry keeps the original previousStatus rather than recording "paused".
  await step(steps, "lock", "Mark suspended and block the portal", async () => {
    const reason = opts.reason ? opts.reason.slice(0, 300) : existing?.reason;
    const record: SuspendedFlag = {
      at: existing?.at ?? nowOf(deps),
      by: existing?.by ?? actor.id,
      mode: opts.mode,
      previousStatus: existing?.previousStatus ?? client.status,
      ...(reason ? { reason } : {}),
      stripe: { action: opts.stripe, prorate },
      ...(existing?.deleting ? { deleting: true } : {}),
    };
    await store.mergeFlags(clientId, { suspended: record });
    await store.patchClient(clientId, { status: "paused" });
  });

  // 2. The phone line.
  await step(steps, "line", opts.mode === "off" ? "Detach the phone line from the AI" : "Switch the AI to messages-only", async () => {
    if (opts.mode === "off") {
      if (!client.retellPhoneNumber) return { status: "skipped", detail: "No phone number to detach" };
      if (!p.configured.retell) throw new Error("Retell isn't configured — the line was NOT detached");
      const out = await p.retellUnbindNumber(client.retellPhoneNumber);
      return { status: out === "already_gone" ? "already_gone" : "done", detail: client.retellPhoneNumber };
    }
    if (!client.retellLlmId) return { status: "skipped", detail: "No agent to switch" };
    if (!p.configured.retell) throw new Error("Retell isn't configured — the agent was NOT switched");
    await p.republishAgent(client.orgId, clientId);
  });

  // 3. Customer texts already waiting in the queue.
  await step(steps, "queued_texts", "Drop queued customer texts", async () => {
    const n = await store.dropQueuedTexts(clientId);
    return n === 0 ? { status: "skipped", detail: "None waiting" } : { detail: `${n} dropped` };
  });

  // 4. Billing.
  await stripeSteps(deps, clientId, { action: opts.stripe, prorate }, steps);

  const res = finish(
    "suspend",
    steps,
    "Company suspended. Its portal is blocked, background jobs, texts and emails skip it, and the AI is " +
      (opts.mode === "off" ? "off." : "taking messages only."),
    "Suspended in our system, but a step at a vendor didn't finish. Retry — only what's left will run.",
  );
  await store.audit({
    clientId,
    actor: actor.id,
    action: "operator.suspend",
    detail: {
      by: actor.email,
      ok: res.ok,
      mode: opts.mode,
      stripe: opts.stripe,
      prorate,
      reason: opts.reason ?? null,
      steps,
      phone: client.retellPhoneNumber,
      agentId: client.retellAgentId,
    },
  });
  return res;
}

export async function reactivateCompany(deps: ControlDeps, actor: Actor, clientId: string): Promise<ControlResult> {
  const { providers: p, store } = deps;
  const client = await store.getClient(clientId);
  if (!client || client.deletedAt) return notFound("reactivate");
  const sus = client.setupFlags?.suspended;
  if (!sus) {
    return { ok: true, action: "reactivate", httpStatus: 200, message: "This company isn't suspended.", steps: [], failedSteps: [] };
  }
  if (sus.deleting) {
    return {
      ok: false,
      action: "reactivate",
      httpStatus: 409,
      message: "This company is being deleted and can't be reactivated.",
      steps: [],
      failedSteps: [],
    };
  }
  const steps: StepResult[] = [];

  // Vendor steps first, the database flag last: if the line can't be re-bound,
  // the business stays suspended and Retry has a clear job.
  if (sus.mode === "off") {
    await step(steps, "line", "Reattach the phone line to the AI", async () => {
      if (!client.retellPhoneNumber || !client.retellAgentId) return { status: "skipped", detail: "No number or agent to reattach" };
      if (!p.configured.retell) throw new Error("Retell isn't configured — the line was NOT reattached");
      const out = await p.retellRebindNumber(client.retellPhoneNumber, client.retellAgentId);
      return { status: out === "already_gone" ? "already_gone" : "done", detail: client.retellPhoneNumber };
    });
  }

  if (sus.stripe.action === "pause") {
    await step(steps, "stripe", "Resume Stripe billing", async () => {
      const sub = await store.getSubscription(clientId);
      if (!sub?.stripeSubscriptionId) return { status: "skipped", detail: "No subscription" };
      if (!p.configured.stripe) throw new Error("Stripe isn't configured — billing was NOT resumed");
      const r = await p.stripeResume(sub.stripeSubscriptionId);
      if (r === "resumed") await store.markSubscriptionStatus(clientId, "active");
      return r === "canceled"
        ? { status: "skipped", detail: "Subscription was canceled in Stripe — they need to pick a plan again" }
        : r === "not_paused"
          ? { status: "skipped", detail: "Wasn't paused" }
          : { detail: "Resumed" };
    });
  } else if (sus.stripe.action === "cancel") {
    steps.push({
      step: "stripe",
      label: "Stripe subscription",
      status: "skipped",
      detail: "It was canceled when suspended and can't be undone — they need to pick a plan again",
    });
  }

  if (steps.every((s) => s.status !== "failed")) {
    await step(steps, "unsuspend", "Unblock the portal and restore status", async () => {
      await store.mergeFlags(clientId, {}, ["suspended"]);
      await store.patchClient(clientId, { status: sus.previousStatus });
    });
    if (sus.mode === "messages_only" && client.retellLlmId && steps.every((s) => s.status !== "failed")) {
      // After the flag is gone, so the rebuilt prompt is the full one.
      await step(steps, "line", "Restore the full AI prompt", async () => {
        await p.republishAgent(client.orgId, clientId);
      });
    }
  }
  const res = finish("reactivate", steps, `Reactivated. Status is back to ${sus.previousStatus}.`);
  await store.audit({ clientId, actor: actor.id, action: "operator.reactivate", detail: { by: actor.email, ok: res.ok, steps } });
  return res;
}

export interface DeleteCompanyOptions {
  /** What the operator typed; must match the business name. */
  confirm: string;
  /** Record email / phone / domain so they can't start another free trial. */
  blockFraud: boolean;
  reason?: string;
}

export async function deleteCompany(
  deps: ControlDeps,
  actor: Actor,
  clientId: string,
  opts: DeleteCompanyOptions,
): Promise<ControlResult> {
  const { store } = deps;
  const client = await store.getClient(clientId);
  if (!client) return notFound("delete_company");
  if (client.deletedAt) {
    return { ok: true, action: "delete_company", httpStatus: 200, message: "This company is already deleted.", steps: [], failedSteps: [] };
  }
  if (!confirmationMatches(opts.confirm, client.name)) {
    return {
      ok: false,
      action: "delete_company",
      httpStatus: 400,
      message: `Type “${client.name}” exactly to confirm.`,
      steps: [],
      failedSteps: [],
    };
  }
  const steps: StepResult[] = [];
  const ids = { phone: client.retellPhoneNumber, agentId: client.retellAgentId, llmId: client.retellLlmId };

  // 1. Lock: out of the portal and every job right now, line detached. This is
  //    the same state as Suspend, marked `deleting` so it can't be reactivated.
  await step(steps, "lock", "Lock the company (portal blocked, jobs skip it)", async () => {
    const existing = client.setupFlags?.suspended;
    const record: SuspendedFlag = {
      at: existing?.at ?? nowOf(deps),
      by: existing?.by ?? actor.id,
      mode: "off",
      previousStatus: existing?.previousStatus ?? client.status,
      ...(opts.reason ? { reason: opts.reason.slice(0, 300) } : {}),
      stripe: { action: "cancel", prorate: false },
      deleting: true,
    };
    await store.mergeFlags(clientId, { suspended: record });
    await store.patchClient(clientId, { status: "paused" });
  });
  await step(steps, "queued_texts", "Drop queued customer texts", async () => {
    const n = await store.dropQueuedTexts(clientId);
    return n === 0 ? { status: "skipped", detail: "None waiting" } : { detail: `${n} dropped` };
  });

  // 2-4. Vendor resources.
  await releaseNumberSteps(deps, clientId, steps);
  await deleteAgentSteps(deps, clientId, steps);
  await stripeSteps(deps, clientId, { action: "cancel", prorate: false }, steps);

  // 5. Fraud flag (optional). Throws on failure, which fails this step.
  if (opts.blockFraud) {
    await step(steps, "fraud_flag", "Block this email / phone / domain from a new free trial", async () => {
      const who = await store.identitiesFor(clientId);
      const identity = identityFrom({ emails: [client.ownerEmail, ...who.emails], phones: who.phones }, (d) => store.isFreeEmailDomain(d));
      if (identity.emails.length === 0 && identity.phones.length === 0) {
        return { status: "skipped", detail: "No customer email or phone on file to block" };
      }
      await store.writeTrialBlock(clientId, identity, { businessName: client.name, reason: opts.reason ?? null, by: actor.email });
      return { detail: `${identity.emails.length} email(s), ${identity.phones.length} phone(s)${identity.domain ? `, @${identity.domain}` : ""}` };
    });
  } else {
    steps.push({ step: "fraud_flag", label: "Fraud flag", status: "skipped", detail: "Not requested" });
  }

  // 6. Soft-delete ONLY when every vendor step is clean. Until then the company
  //    stays in the list (locked) so the operator can see it and press Retry.
  if (steps.every((s) => s.status !== "failed")) {
    await step(steps, "soft_delete", "Remove from lists; call data purges on the 90-day schedule", async () => {
      await store.patchClient(clientId, { deletedAt: deps.now?.() ?? new Date() });
    });
  } else {
    steps.push({
      step: "soft_delete",
      label: "Remove from lists",
      status: "failed",
      error: "Waiting on the failed step above — the company is locked but still listed so you can retry.",
    });
  }

  const res = finish(
    "delete_company",
    steps,
    "Company deleted. Its number and agent are released, its subscription is canceled, and it's gone from your lists. Call data purges in 90 days.",
  );
  await store.audit({
    clientId,
    actor: actor.id,
    action: "operator.delete_company",
    detail: { by: actor.email, ok: res.ok, name: client.name, blockFraud: opts.blockFraud, reason: opts.reason ?? null, ids, steps },
  });
  return res;
}
