import "server-only";
import twilio from "twilio";
import { env, integrations, webhookUrl } from "@/lib/env";
import { getRetellClient } from "@/lib/retell";
import { getStripe } from "@/lib/stripe";
import type { OperatorProviders, Outcome } from "./controls";
import type { OrphanProviders } from "./orphans";

/**
 * The live vendor calls behind the operator controls. This is the ONLY place
 * the delete / release / cancel endpoints are called; every other module (and
 * every test) goes through the `OperatorProviders` / `OrphanProviders`
 * interfaces. Retell calls are kept additive and separate from lib/retell.ts
 * on purpose (that file is busy), importing only its client getter.
 *
 * "Already gone" (404 / resource_missing) is a success everywhere here.
 */

export function isGone(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; code?: unknown; message?: string };
  if (e?.status === 404 || e?.statusCode === 404) return true;
  if (e?.code === "resource_missing" || e?.code === 20404) return true;
  // The Retell SDK words a missing resource as a 404 or a 422 "cannot find requested asset".
  return /\b404\b|not found|cannot find requested asset|no such (subscription|phone)/i.test(e?.message ?? "");
}

async function gone(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    await run();
    return "done";
  } catch (err) {
    if (isGone(err)) return "already_gone";
    throw err;
  }
}

const twilioClient = () => twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

async function cancelNow(subscriptionId: string, prorate: boolean): Promise<Outcome> {
  const stripe = getStripe();
  try {
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    if (current.status === "canceled") return "already_gone";
  } catch (err) {
    if (isGone(err)) return "already_gone";
    throw err;
  }
  // invoice_now false: never raise a final invoice. prorate false: no credit
  // for unused time — "cancel now, no refund" is the default the UI states.
  return gone(() => stripe.subscriptions.cancel(subscriptionId, { prorate, invoice_now: false }));
}

export function liveProviders(): OperatorProviders & OrphanProviders {
  return {
    configured: { retell: integrations.retell(), stripe: integrations.stripe(), twilio: integrations.twilio() },

    /* ---- per-business actions ---- */
    retellUnbindNumber: (phone) =>
      gone(() => getRetellClient().phoneNumber.update(phone, { inbound_agents: null, outbound_agents: null })),
    retellRebindNumber: (phone, agentId) =>
      gone(() =>
        getRetellClient().phoneNumber.update(phone, {
          inbound_agents: [{ agent_id: agentId, weight: 1 }],
          inbound_webhook_url: webhookUrl("/api/webhooks/retell"),
        }),
      ),
    retellReleaseNumber: (phone) => gone(() => getRetellClient().phoneNumber.delete(phone)),
    retellDeleteAgent: (id) => gone(() => getRetellClient().agent.delete(id)),
    retellDeleteLlm: (id) => gone(() => getRetellClient().llm.delete(id)),
    twilioReleaseNumber: (sid) => gone(() => twilioClient().incomingPhoneNumbers(sid).remove()),

    stripeCancel: (id, { prorate }) => cancelNow(id, prorate),
    async stripeOpenSubscriptionsFor(customerId) {
      const out: string[] = [];
      for await (const s of getStripe().subscriptions.list({ customer: customerId, status: "all", limit: 100 })) {
        if (s.status !== "canceled" && s.status !== "incomplete_expired") out.push(s.id);
      }
      return out;
    },
    stripePause: (id) => gone(() => getStripe().subscriptions.update(id, { pause_collection: { behavior: "void" } })),
    async stripeResume(id) {
      const stripe = getStripe();
      const s = await stripe.subscriptions.retrieve(id);
      if (s.status === "canceled") return "canceled";
      if (!s.pause_collection) return "not_paused";
      await stripe.subscriptions.update(id, { pause_collection: "" });
      return "resumed";
    },
    async republishAgent(orgId, clientId) {
      // Lazy: agent-publish pulls in the whole calendar/voice stack.
      const { syncAgentPrompt } = await import("@/lib/agent-publish");
      await syncAgentPrompt(orgId, clientId);
    },

    /* ---- orphan listing (read-only) ---- */
    async listRetellAgents() {
      const agents = await getRetellClient().agent.list({ is_latest: true, limit: 1000 });
      const seen = new Map<string, { id: string; name: string | null; modifiedAt: number | null }>();
      for (const a of agents) {
        seen.set(a.agent_id, { id: a.agent_id, name: a.agent_name ?? null, modifiedAt: a.last_modification_timestamp ?? null });
      }
      return [...seen.values()];
    },
    async listRetellLlms() {
      const out: { id: string; modifiedAt: number | null }[] = [];
      let key: string | undefined;
      for (let page = 0; page < 20; page++) {
        const res = await getRetellClient().llm.list({ limit: 200, ...(key ? { pagination_key: key } : {}) });
        for (const l of res.items ?? []) out.push({ id: l.llm_id, modifiedAt: l.last_modification_timestamp ?? null });
        key = res.pagination_key ?? undefined;
        if (!res.has_more || !key) break;
      }
      return out;
    },
    async listRetellNumbers() {
      const out: { phone: string; nickname: string | null }[] = [];
      let key: string | undefined;
      for (let page = 0; page < 20; page++) {
        const res = await getRetellClient().phoneNumber.list({ limit: 200, ...(key ? { pagination_key: key } : {}) });
        for (const n of res.items ?? []) out.push({ phone: n.phone_number, nickname: n.nickname ?? null });
        key = res.pagination_key ?? undefined;
        if (!res.has_more || !key) break;
      }
      return out;
    },
    async listTwilioAppNumbers() {
      // Only numbers the app bought (tollfree/twilio-api.ts names them "FrontDesk SMS · …"),
      // so the shared sender and anything else in the Twilio account is never offered.
      const nums = await twilioClient().incomingPhoneNumbers.list({ limit: 200 });
      return nums
        .filter((n) => (n.friendlyName ?? "").startsWith("FrontDesk SMS") && n.phoneNumber !== env.TWILIO_FROM_NUMBER)
        .map((n) => ({ sid: n.sid, phone: n.phoneNumber, name: n.friendlyName ?? "" }));
    },
    async listStripeAppSubscriptions() {
      const out: { id: string; clientId: string | null; customer: string; summary: string }[] = [];
      let seen = 0;
      for await (const s of getStripe().subscriptions.list({ limit: 100, expand: ["data.customer"] })) {
        if (++seen > 500) break;
        // Only subscriptions our checkout stamped; anything else in the account isn't ours to judge.
        const clientId = s.metadata?.clientId ?? null;
        if (!clientId) continue;
        const cust = typeof s.customer === "string" ? null : s.customer;
        const email = cust && !("deleted" in cust && cust.deleted) ? (cust as { email?: string | null }).email : null;
        const price = s.items.data[0]?.price;
        const amount = price?.unit_amount
          ? `$${(price.unit_amount / 100).toFixed(0)}/${price.recurring?.interval === "year" ? "yr" : "mo"}`
          : "subscription";
        out.push({
          id: s.id,
          clientId,
          customer: typeof s.customer === "string" ? s.customer : s.customer.id,
          summary: `${amount} · ${email ?? "no email"} · ${s.status}`,
        });
      }
      return out;
    },
    deleteRetellAgent: (id) => gone(() => getRetellClient().agent.delete(id)),
    deleteRetellLlm: (id) => gone(() => getRetellClient().llm.delete(id)),
    releaseRetellNumber: (phone) => gone(() => getRetellClient().phoneNumber.delete(phone)),
    releaseTwilioNumber: (sid) => gone(() => twilioClient().incomingPhoneNumbers(sid).remove()),
    cancelStripeSubscription: (id) => cancelNow(id, false),
  };
}
