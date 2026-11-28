import type { Actor, ControlStore, Outcome } from "./controls";

/**
 * Orphans: things we pay a vendor for that no active business points at.
 *
 * Read-only until the operator clicks a delete button. Each provider is listed
 * independently, so one vendor being down shows as "couldn't check Stripe"
 * rather than hiding the other lists.
 *
 * A resource counts as matched only by an ACTIVE (not deleted) business. A
 * business the owner closed from their own portal leaves its Retell ids behind
 * in the row; those still bill, so they show up here.
 */

export type OrphanKind = "retell_agent" | "retell_llm" | "retell_number" | "twilio_number" | "stripe_subscription";

export interface OrphanItem {
  kind: OrphanKind;
  id: string;
  label: string;
  /** Extra context for the confirm dialog (created date, customer, price …). */
  detail?: string;
}

export interface OrphanReport {
  items: OrphanItem[];
  /** Providers we couldn't read, with the reason. Never hides the others. */
  errors: { provider: "Retell" | "Twilio" | "Stripe"; message: string }[];
  /** Providers that aren't configured at all (so an empty list isn't a clean bill of health). */
  notConfigured: ("Retell" | "Twilio" | "Stripe")[];
}

/** What active businesses legitimately hold. */
export interface ActiveHoldings {
  agentIds: Set<string>;
  llmIds: Set<string>;
  /** Digits only, last ten. */
  phoneDigits: Set<string>;
  tollfreeSids: Set<string>;
  smsNumbers: Set<string>;
  stripeSubscriptionIds: Set<string>;
  /** Active businesses whose subscription mirror has no Stripe id yet (a checkout the webhook hasn't landed). */
  clientsAwaitingSubscription: Set<string>;
}

/** Read access to the vendors, for listing and for deleting one orphan. */
export interface OrphanProviders {
  configured: { retell: boolean; stripe: boolean; twilio: boolean };
  listRetellAgents(): Promise<{ id: string; name: string | null; modifiedAt: number | null }[]>;
  listRetellLlms(): Promise<{ id: string; modifiedAt: number | null }[]>;
  listRetellNumbers(): Promise<{ phone: string; nickname: string | null }[]>;
  /** Numbers in our Twilio account that the app bought (friendly name "FrontDesk SMS …"). */
  listTwilioAppNumbers(): Promise<{ sid: string; phone: string; name: string }[]>;
  /** Open subscriptions that carry our metadata.clientId. */
  listStripeAppSubscriptions(): Promise<{ id: string; clientId: string | null; customer: string; summary: string }[]>;
  deleteRetellAgent(id: string): Promise<Outcome>;
  deleteRetellLlm(id: string): Promise<Outcome>;
  releaseRetellNumber(phone: string): Promise<Outcome>;
  releaseTwilioNumber(sid: string): Promise<Outcome>;
  cancelStripeSubscription(id: string): Promise<Outcome>;
}

export interface OrphanStore {
  activeHoldings(): Promise<ActiveHoldings>;
  audit: ControlStore["audit"];
}

const digits = (p: string) => p.replace(/\D/g, "").slice(-10);
const when = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 200);

export async function listOrphans(deps: { providers: OrphanProviders; store: OrphanStore }): Promise<OrphanReport> {
  const { providers: p, store } = deps;
  const hold = await store.activeHoldings();
  const items: OrphanItem[] = [];
  const errors: OrphanReport["errors"] = [];
  const notConfigured: OrphanReport["notConfigured"] = [];

  if (!p.configured.retell) notConfigured.push("Retell");
  else {
    try {
      for (const a of await p.listRetellAgents()) {
        if (hold.agentIds.has(a.id)) continue;
        items.push({
          kind: "retell_agent",
          id: a.id,
          label: a.name || "Unnamed agent",
          detail: [`Retell agent ${a.id}`, when(a.modifiedAt) && `last changed ${when(a.modifiedAt)}`].filter(Boolean).join(" · "),
        });
      }
    } catch (e) {
      errors.push({ provider: "Retell", message: `Agents: ${msg(e)}` });
    }
    try {
      for (const l of await p.listRetellLlms()) {
        if (hold.llmIds.has(l.id)) continue;
        items.push({
          kind: "retell_llm",
          id: l.id,
          label: "AI prompt (LLM)",
          detail: [`Retell LLM ${l.id}`, when(l.modifiedAt) && `last changed ${when(l.modifiedAt)}`].filter(Boolean).join(" · "),
        });
      }
    } catch (e) {
      errors.push({ provider: "Retell", message: `LLMs: ${msg(e)}` });
    }
    try {
      for (const n of await p.listRetellNumbers()) {
        if (hold.phoneDigits.has(digits(n.phone))) continue;
        items.push({
          kind: "retell_number",
          id: n.phone,
          label: n.phone,
          detail: `Retell phone number — bills monthly${n.nickname ? ` · “${n.nickname}”` : ""}`,
        });
      }
    } catch (e) {
      errors.push({ provider: "Retell", message: `Numbers: ${msg(e)}` });
    }
  }

  if (!p.configured.twilio) notConfigured.push("Twilio");
  else {
    try {
      for (const n of await p.listTwilioAppNumbers()) {
        if (hold.tollfreeSids.has(n.sid) || hold.smsNumbers.has(n.phone)) continue;
        items.push({ kind: "twilio_number", id: n.sid, label: n.phone, detail: `Twilio texting number “${n.name}” — bills monthly` });
      }
    } catch (e) {
      errors.push({ provider: "Twilio", message: msg(e) });
    }
  }

  if (!p.configured.stripe) notConfigured.push("Stripe");
  else {
    try {
      for (const s of await p.listStripeAppSubscriptions()) {
        if (hold.stripeSubscriptionIds.has(s.id)) continue;
        if (s.clientId && hold.clientsAwaitingSubscription.has(s.clientId)) continue;
        items.push({
          kind: "stripe_subscription",
          id: s.id,
          label: s.summary,
          detail: `Stripe subscription ${s.id} · customer ${s.customer} — still charging`,
        });
      }
    } catch (e) {
      errors.push({ provider: "Stripe", message: msg(e) });
    }
  }
  return { items, errors, notConfigured };
}

export interface OrphanDeleteResult {
  ok: boolean;
  httpStatus: 200 | 404 | 409 | 502;
  message: string;
}

/**
 * Delete ONE orphan. The server re-checks and refuses anything that currently
 * belongs to an active business, so a forged request can't remove a live
 * business's agent or number.
 */
export async function deleteOrphan(
  deps: { providers: OrphanProviders; store: OrphanStore },
  actor: Actor,
  target: { kind: OrphanKind; id: string },
): Promise<OrphanDeleteResult> {
  const { providers: p, store } = deps;
  const hold = await store.activeHoldings();
  const matched =
    target.kind === "retell_agent"
      ? hold.agentIds.has(target.id)
      : target.kind === "retell_llm"
        ? hold.llmIds.has(target.id)
        : target.kind === "retell_number"
          ? hold.phoneDigits.has(digits(target.id))
          : target.kind === "twilio_number"
            ? hold.tollfreeSids.has(target.id)
            : hold.stripeSubscriptionIds.has(target.id);
  if (matched) {
    return { ok: false, httpStatus: 409, message: "That resource belongs to an active business, so it isn't an orphan. Nothing was deleted." };
  }
  try {
    const out =
      target.kind === "retell_agent"
        ? await p.deleteRetellAgent(target.id)
        : target.kind === "retell_llm"
          ? await p.deleteRetellLlm(target.id)
          : target.kind === "retell_number"
            ? await p.releaseRetellNumber(target.id)
            : target.kind === "twilio_number"
              ? await p.releaseTwilioNumber(target.id)
              : await p.cancelStripeSubscription(target.id);
    await store.audit({
      clientId: null,
      actor: actor.id,
      action: "operator.delete_orphan",
      detail: { by: actor.email, kind: target.kind, id: target.id, outcome: out },
    });
    return {
      ok: true,
      httpStatus: 200,
      message: out === "already_gone" ? "Already gone at the vendor — nothing left to delete." : "Deleted.",
    };
  } catch (err) {
    const message = msg(err);
    await store.audit({
      clientId: null,
      actor: actor.id,
      action: "operator.delete_orphan_failed",
      detail: { by: actor.email, kind: target.kind, id: target.id, error: message },
    });
    return { ok: false, httpStatus: 502, message: `The vendor refused: ${message}` };
  }
}
