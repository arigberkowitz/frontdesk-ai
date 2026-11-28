import { confirmationMatches } from "@/lib/account-close";
import {
  deleteAgentSteps,
  finish,
  nowOf,
  notFound,
  releaseNumberSteps,
  step,
  type Actor,
  type ChecklistLine,
  type ControlClient,
  type ControlDeps,
  type ControlResult,
  type RemainingRows,
  type ScheduledWork,
  type StepResult,
} from "./controls";
import type { SuspendedFlag } from "./suspension";
import { identityFrom } from "./trial-block";

/**
 * Delete a business so nothing can ever bill again, then PROVE it.
 *
 * Two modes share one pipeline:
 *  - `deleteCompany`: everything at the vendors goes, the business is hidden from
 *    every list, and its data purges on the 90-day schedule.
 *  - `permanentDelete`: the same, and then the business's database rows are
 *    deleted right away (calls, leads, messages, knowledge, customers' numbers,
 *    its portal users, the audit trail that names it). What stays: the Stripe
 *    billing records (they live in Stripe), any fraud flag the operator chose to
 *    record, and one receipt that holds only the id, name, who and when.
 *
 * Pipeline: lock -> cancel scheduled work -> release every number -> delete
 * agent + LLM -> revoke the calendar grant -> cancel Stripe and wind it down ->
 * (fraud flag) -> VERIFY by re-asking each vendor -> then, and only then, hide
 * (soft) or purge (permanent). Success is reported only when every line of the
 * verification reads zero. A failed or unverifiable step leaves the business
 * locked and listed, with its vendor pointers intact, so Retry finishes it.
 */

export interface DeleteCompanyOptions {
  /** What the operator typed; must match the business name. */
  confirm: string;
  /** Record email / phone / domain so they can't start another free trial. */
  blockFraud: boolean;
  reason?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const digits = (p: string) => p.replace(/\D/g, "").slice(-10);

/** What the business held at the start of this run, kept so verification still knows what to look for after the DB pointers are cleared. */
interface Snapshot {
  clientId: string;
  name: string;
  agentId: string | null;
  llmId: string | null;
  phone: string | null;
  tollfreeSid: string | null;
  customerId: string | null;
  hadSubscription: boolean;
}

/* ------------------------------- steps ---------------------------------- */

async function cancelWorkSteps(deps: ControlDeps, clientId: string, steps: StepResult[]): Promise<void> {
  await step(steps, "scheduled", "Cancel scheduled texts, reminders, callbacks and waitlist offers", async () => {
    const w = await deps.store.cancelScheduledWork(clientId);
    const parts = [
      w.queuedTexts && plural(w.queuedTexts, "queued text"),
      w.queuedReminders && plural(w.queuedReminders, "reminder"),
      w.pendingCallbacks && plural(w.pendingCallbacks, "callback"),
      w.waitingWaitlist && plural(w.waitingWaitlist, "waitlist offer"),
      w.pushSubscriptions && plural(w.pushSubscriptions, "push subscription"),
    ].filter(Boolean);
    return parts.length ? { detail: `${parts.join(", ")} canceled` } : { status: "skipped", detail: "Nothing was waiting" };
  });
}

/** Release every Retell number that belongs to the business, including ones our database lost track of. */
async function extraRetellNumberSteps(deps: ControlDeps, snap: Snapshot, steps: StepResult[]): Promise<void> {
  const { providers: p } = deps;
  if (!p.configured.retell) return; // the on-file step already failed loudly if there was something to release
  await step(steps, "retell_number", "Release any other Retell number tied to this business", async () => {
    const found = await p.retellNumbersFor({ clientId: snap.clientId, agentId: snap.agentId, phone: snap.phone });
    if (found.length === 0) return { status: "skipped", detail: "No others found at Retell" };
    for (const phone of found) {
      try {
        await p.retellUnbindNumber(phone);
      } catch {
        // best effort; the release below is what matters
      }
      await p.retellReleaseNumber(phone);
    }
    return { detail: found.join(", ") };
  });
}

/** Release every Twilio number the app bought for the business, and drop its toll-free verification. */
async function extraTwilioSteps(deps: ControlDeps, snap: Snapshot, verificationSid: string | null, steps: StepResult[]): Promise<void> {
  const { providers: p } = deps;
  if (!p.configured.twilio) return;
  await step(steps, "twilio_number", "Release any other texting number we bought for this business", async () => {
    const found = await p.twilioNumbersNamed(`FrontDesk SMS · ${snap.name}`.slice(0, 64));
    const todo = found.filter((n) => n.sid !== snap.tollfreeSid);
    if (todo.length === 0) return { status: "skipped", detail: "No others found at Twilio" };
    for (const n of todo) await p.twilioReleaseNumber(n.sid);
    return { detail: todo.map((n) => n.phone).join(", ") };
  });
  if (verificationSid) {
    // Free, so a failure never blocks the delete; it just isn't claimed as done.
    try {
      const out = await p.twilioDeleteTollfreeVerification(verificationSid);
      steps.push({ step: "twilio_verification", label: "Delete the toll-free verification", status: out === "already_gone" ? "already_gone" : "done", detail: verificationSid });
    } catch (err) {
      steps.push({
        step: "twilio_verification",
        label: "Delete the toll-free verification",
        status: "skipped",
        detail: `Twilio wouldn't delete it (${(err instanceof Error ? err.message : String(err)).slice(0, 120)}). It's free and tied to a number that's released.`,
      });
    }
  }
}

async function calendarSteps(deps: ControlDeps, client: ControlClient, steps: StepResult[]): Promise<void> {
  const { providers: p, store } = deps;
  if (!client.calendarProvider && !client.calendarSecret) {
    steps.push({ step: "calendar", label: "Remove calendar connection", status: "skipped", detail: "No calendar connected" });
    return;
  }
  await step(steps, "calendar", "Revoke and remove the calendar connection", async () => {
    // Revoke is best effort (the grant lingering in the owner's account costs nobody anything);
    // the stored token is removed either way so we can no longer read or write their calendar.
    let how: "revoked" | "none" | "manual" = "none";
    try {
      how = await p.revokeCalendar(client.calendarProvider, client.calendarSecret);
    } catch {
      how = "manual";
    }
    await store.patchClient(client.id, {
      calendarProvider: null,
      calendarSecret: null,
      calendarId: null,
      calendarAccount: null,
      calendarConnectedAt: null,
      calendarBusyIds: null,
    });
    const what = client.calendarProvider === "calcom" ? "Cal.com key" : `${client.calendarProvider ?? "Calendar"} token`;
    return {
      detail:
        how === "revoked"
          ? `${what} revoked and removed`
          : `${what} removed from our database${how === "manual" ? " — the owner can remove the app's access in their own account" : ""}`,
    };
  });
}

/** Stripe: cancel every subscription now, then make sure nothing is left that could bill. */
async function stripeFullSteps(deps: ControlDeps, snap: Snapshot, steps: StepResult[]): Promise<void> {
  const { providers: p, store } = deps;
  const sub = await store.getSubscription(snap.clientId);
  const onFile = Boolean(sub?.stripeSubscriptionId || sub?.stripeCustomerId);

  await step(steps, "stripe", "Cancel every Stripe subscription now", async () => {
    if (!p.configured.stripe) {
      if (onFile) throw new Error("Stripe isn't configured — the subscription was NOT canceled; do it in the Stripe dashboard");
      return { status: "skipped", detail: "Stripe isn't configured and nothing is on file" };
    }
    const ids = new Set<string>();
    // A mirror already marked canceled is not asked again; Stripe is still searched for anything else.
    if (sub?.stripeSubscriptionId && sub.status !== "canceled") ids.add(sub.stripeSubscriptionId);
    if (sub?.stripeCustomerId) for (const id of await p.stripeOpenSubscriptionsFor(sub.stripeCustomerId)) ids.add(id);
    for (const id of await p.stripeSubscriptionsByClient(snap.clientId)) ids.add(id);
    let gone = 0;
    for (const id of ids) {
      if ((await p.stripeCancel(id, { prorate: false })) === "already_gone") gone += 1;
    }
    if (sub) await store.markSubscriptionStatus(snap.clientId, "canceled");
    if (ids.size === 0) return { status: "skipped", detail: "No open subscription" };
    return { status: gone === ids.size ? "already_gone" : "done", detail: `${[...ids].join(", ")} · no refund, no proration, no final invoice` };
  });

  await step(steps, "stripe_cleanup", "Void unpaid invoices, remove pending charges, cancel schedules and open checkouts", async () => {
    if (!p.configured.stripe) return { status: "skipped", detail: "Stripe isn't configured" };
    const w = await p.stripeWindDown({ clientId: snap.clientId, customerId: sub?.stripeCustomerId ?? snap.customerId });
    const parts = [
      w.invoicesVoided && plural(w.invoicesVoided, "open invoice") + " voided",
      w.draftInvoicesDeleted && plural(w.draftInvoicesDeleted, "draft invoice") + " deleted",
      w.pendingItemsRemoved && plural(w.pendingItemsRemoved, "pending charge") + " removed",
      w.schedulesCanceled && plural(w.schedulesCanceled, "schedule") + " canceled",
      w.checkoutsExpired && plural(w.checkoutsExpired, "open checkout") + " expired",
    ].filter(Boolean);
    return parts.length ? { detail: parts.join(" · ") } : { status: "skipped", detail: "Nothing else could bill" };
  });
}

/* ------------------------------ verification ----------------------------- */

const zeroWork = (w: ScheduledWork) => w.queuedTexts + w.queuedReminders + w.pendingCallbacks + w.waitingWaitlist === 0;

/** Re-ask every vendor what the business still holds. Never trusts what we just did. */
export async function verifyVendors(deps: ControlDeps, snap: Snapshot): Promise<ChecklistLine[]> {
  const { providers: p, store } = deps;
  const lines: ChecklistLine[] = [];
  const fresh = (await store.getClient(snap.clientId)) ?? null;

  // Retell
  if (p.configured.retell) {
    const numbers = new Set(await p.retellNumbersFor({ clientId: snap.clientId, agentId: snap.agentId, phone: snap.phone }));
    if (snap.phone) {
      // a number we released can also be named by its pointer alone
      for (const n of [...numbers]) if (digits(n) === digits(snap.phone)) numbers.add(n);
    }
    let agents = 0;
    for (const id of new Set([snap.agentId, fresh?.retellAgentId].filter((x): x is string => Boolean(x)))) {
      if (await p.retellAgentExists(id)) agents += 1;
    }
    let llms = 0;
    for (const id of new Set([snap.llmId, fresh?.retellLlmId].filter((x): x is string => Boolean(x)))) {
      if (await p.retellLlmExists(id)) llms += 1;
    }
    lines.push({
      vendor: "Retell",
      text: `${plural(numbers.size, "number")}, ${plural(agents, "agent")}, ${plural(llms, "LLM")}`,
      zero: numbers.size + agents + llms === 0,
    });
  } else {
    const held = Boolean(snap.agentId || snap.llmId || snap.phone);
    lines.push({
      vendor: "Retell",
      text: held ? "can't be checked: Retell isn't configured" : "not configured, nothing on file",
      zero: !held,
    });
  }

  // Twilio
  if (p.configured.twilio) {
    const left = new Map<string, string>();
    if (snap.tollfreeSid && (await p.twilioNumberExists(snap.tollfreeSid))) left.set(snap.tollfreeSid, snap.tollfreeSid);
    for (const n of await p.twilioNumbersNamed(`FrontDesk SMS · ${snap.name}`.slice(0, 64))) left.set(n.sid, n.phone);
    lines.push({ vendor: "Twilio", text: plural(left.size, "number"), zero: left.size === 0 });
  } else {
    lines.push({
      vendor: "Twilio",
      text: snap.tollfreeSid ? "can't be checked: Twilio isn't configured" : "not configured, nothing on file",
      zero: !snap.tollfreeSid,
    });
  }

  // Stripe
  if (p.configured.stripe) {
    const sub = await store.getSubscription(snap.clientId);
    const inv = await p.stripeInventory({ clientId: snap.clientId, customerId: sub?.stripeCustomerId ?? snap.customerId });
    const zero = inv.activeSubscriptions + inv.openInvoices + inv.pendingItems + inv.activeSchedules + inv.openCheckouts === 0;
    lines.push({
      vendor: "Stripe",
      text:
        `${plural(inv.activeSubscriptions, "active subscription")}, ${plural(inv.openInvoices, "open invoice")}` +
        (inv.pendingItems + inv.activeSchedules + inv.openCheckouts > 0
          ? `, ${plural(inv.pendingItems, "pending charge")}, ${plural(inv.activeSchedules, "schedule")}, ${plural(inv.openCheckouts, "open checkout")}`
          : ""),
      zero,
    });
  } else {
    lines.push({
      vendor: "Stripe",
      text: snap.hadSubscription ? "can't be checked: Stripe isn't configured" : "not configured, nothing on file",
      zero: !snap.hadSubscription,
    });
  }

  // Calendar + jobs (ours)
  const cal = Boolean(fresh?.calendarProvider || fresh?.calendarSecret);
  lines.push({ vendor: "Calendar", text: cal ? "a calendar token is still stored" : "0 stored tokens", zero: !cal });
  const work = await store.pendingWork(snap.clientId);
  lines.push({
    vendor: "Jobs",
    text: `${plural(work.queuedTexts + work.queuedReminders + work.pendingCallbacks + work.waitingWaitlist, "scheduled item")}`,
    zero: zeroWork(work),
  });
  return lines;
}

const dbText = (r: RemainingRows) =>
  `${plural(r.calls, "call")}, ${plural(r.leads, "lead")}, ${plural(r.messages, "message")}, ${plural(r.knowledge, "knowledge item")}, ${plural(r.users, "user")}`;
const dbZero = (r: RemainingRows) => Object.values(r).every((n) => n === 0);

/* -------------------------------- actions -------------------------------- */

type Mode = "soft" | "permanent";

async function run(deps: ControlDeps, actor: Actor, clientId: string, opts: DeleteCompanyOptions, mode: Mode): Promise<ControlResult> {
  const action = mode === "permanent" ? "permanent_delete" : "delete_company";
  const { store } = deps;
  const client = await store.getClient(clientId);
  if (!client) return notFound(action);
  if (!confirmationMatches(opts.confirm, client.name)) {
    return { ok: false, action, httpStatus: 400, message: `Type “${client.name}” exactly to confirm.`, steps: [], failedSteps: [] };
  }
  const steps: StepResult[] = [];
  const tf = await store.getTollfree(clientId);
  const sub = await store.getSubscription(clientId);
  const snap: Snapshot = {
    clientId,
    name: client.name,
    agentId: client.retellAgentId,
    llmId: client.retellLlmId,
    phone: client.retellPhoneNumber,
    tollfreeSid: tf?.phoneNumberSid ?? null,
    customerId: sub?.stripeCustomerId ?? null,
    hadSubscription: Boolean(sub?.stripeSubscriptionId || sub?.stripeCustomerId),
  };

  // 1. Lock: out of the portal and every job right now. Same state as Suspend,
  //    marked `deleting` so it can't be reactivated. Safe to repeat.
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

  // 2. Everything that would still fire.
  await cancelWorkSteps(deps, clientId, steps);

  // 3. Numbers (Retell voice + Twilio texting), then agent + LLM, calendar, Stripe.
  await releaseNumberSteps(deps, clientId, steps);
  await extraRetellNumberSteps(deps, snap, steps);
  await extraTwilioSteps(deps, snap, tf?.verificationSid ?? null, steps);
  await deleteAgentSteps(deps, clientId, steps);
  await calendarSteps(deps, client, steps);
  await stripeFullSteps(deps, snap, steps);

  // 4. Fraud flag (optional). Throws on failure, which fails this step.
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

  // 5. VERIFY: re-ask every vendor. Success needs every line at zero.
  let checklist: ChecklistLine[] = [];
  const vendorStepsClean = steps.every((s) => s.status !== "failed");
  await step(steps, "verify", "Re-check every vendor", async () => {
    checklist = await verifyVendors(deps, snap);
    const bad = checklist.filter((l) => !l.zero);
    if (bad.length > 0) throw new Error(`Still holding something: ${bad.map((l) => `${l.vendor}: ${l.text}`).join("; ")}`);
    if (!vendorStepsClean) throw new Error("A step above failed, so this can't be called clean yet");
    return { detail: checklist.map((l) => `${l.vendor}: ${l.text}`).join(" · ") };
  });
  const verified = steps.every((s) => s.status !== "failed");

  // 6. Only a verified-clean business is hidden (soft) or purged (permanent).
  if (!verified) {
    steps.push({
      step: mode === "permanent" ? "db_purge" : "soft_delete",
      label: mode === "permanent" ? "Delete our database records" : "Remove from lists",
      status: "failed",
      error: "Waiting on the failed step above — the company is locked but still listed, with its records intact, so you can retry.",
    });
  } else if (mode === "soft") {
    await step(steps, "soft_delete", "Remove from lists; call data purges on the 90-day schedule", async () => {
      await store.patchClient(clientId, { deletedAt: deps.now?.() ?? new Date() });
    });
  } else {
    await permanentSteps(deps, snap, steps, (c) => (checklist = [...checklist, ...c]));
  }

  const ok = steps.every((s) => s.status !== "failed");
  const res = finish(
    action,
    steps,
    mode === "permanent"
      ? "Permanently deleted. Everything is gone and nothing can bill again — checked at every vendor just now."
      : "Company deleted. Its numbers, agent and subscription are gone, nothing can bill again — checked at every vendor just now. Call data purges in 90 days.",
    ok
      ? undefined
      : "Not finished, so nothing was reported as clean. The company stays locked and listed with its records; press Retry and only what's left will run.",
  );
  res.checklist = checklist;

  // The receipt. A permanent delete keeps only who / what / when.
  if (mode === "permanent" && ok) {
    await store.audit({
      clientId: null,
      actor: actor.id,
      action: "operator.permanent_delete",
      detail: { id: clientId, name: client.name, at: nowOf(deps) },
    });
  } else {
    await store.audit({
      clientId,
      actor: actor.id,
      action: mode === "permanent" ? "operator.permanent_delete_attempt" : "operator.delete_company",
      detail: {
        by: actor.email,
        ok,
        name: client.name,
        blockFraud: opts.blockFraud,
        reason: opts.reason ?? null,
        ids: { phone: snap.phone, agentId: snap.agentId, llmId: snap.llmId },
        steps,
        checklist,
      },
    });
  }
  return res;
}

async function permanentSteps(
  deps: ControlDeps,
  snap: Snapshot,
  steps: StepResult[],
  addChecklist: (c: ChecklistLine[]) => void,
): Promise<void> {
  const { providers: p, store } = deps;

  // Retell keeps its own copy of every call (recording + transcript). Not billable,
  // so it never blocks the purge, but it is removed where we can and counted honestly.
  await step(steps, "retell_calls", "Delete Retell's copies of this business's calls", async () => {
    const ids = await store.listRetellCallIds(snap.clientId);
    if (ids.length === 0) return { status: "skipped", detail: "No call records" };
    if (!p.configured.retell) return { status: "skipped", detail: `${plural(ids.length, "call record")} left at Retell (not configured); not billable` };
    let gone = 0;
    let left = 0;
    for (const id of ids) {
      try {
        await p.retellDeleteCall(id);
        gone += 1;
      } catch {
        left += 1;
      }
    }
    return left === 0
      ? { detail: `${plural(gone, "call record")} deleted` }
      : { status: "skipped", detail: `${gone} deleted, ${left} couldn't be deleted at Retell (not billable; they age out under Retell's retention)` };
  });

  await step(steps, "db_purge", "Delete the business's database records", async () => {
    await store.purgeBusiness(snap.clientId, { agentId: snap.agentId, phone: snap.phone });
    const left = await store.remainingRows(snap.clientId);
    addChecklist([{ vendor: "Database", text: dbText(left), zero: dbZero(left) }]);
    if (!dbZero(left)) throw new Error(`Rows still in our database: ${dbText(left)}`);
    return { detail: "calls, leads, messages, knowledge, customers' numbers and portal users removed; audit trail scrubbed" };
  });
}

export const deleteCompany = (deps: ControlDeps, actor: Actor, clientId: string, opts: DeleteCompanyOptions) =>
  run(deps, actor, clientId, opts, "soft");

export const permanentDelete = (deps: ControlDeps, actor: Actor, clientId: string, opts: DeleteCompanyOptions) =>
  run(deps, actor, clientId, opts, "permanent");

