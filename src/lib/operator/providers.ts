import "server-only";
import twilio from "twilio";
import { env, integrations, webhookUrl } from "@/lib/env";
import { getRetellClient } from "@/lib/retell";
import { agentBindings } from "@/lib/retell-outbound";
import { getStripe } from "@/lib/stripe";
import { decryptSecret } from "@/lib/crypto";
import { revokeGoogleToken } from "@/lib/google-calendar";
import type { OperatorProviders, Outcome, StripeInventory, StripeWindDown } from "./controls";
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
    // A subscription run by a schedule is canceled through the schedule; do it
    // first so the schedule can't start a new one.
    const scheduleId = typeof current.schedule === "string" ? current.schedule : (current.schedule?.id ?? null);
    if (scheduleId) {
      try {
        await stripe.subscriptionSchedules.cancel(scheduleId, { invoice_now: false, prorate: false });
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    }
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
          ...agentBindings(agentId),
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

    /* ---- full delete: re-ask the vendors ---- */
    async retellNumbersFor({ clientId, agentId, phone }) {
      const tag = `(${clientId.slice(0, 8)})`;
      const want = phone ? phone.replace(/\D/g, "").slice(-10) : null;
      const found = new Set<string>();
      let key: string | undefined;
      for (let page = 0; page < 20; page++) {
        const res = await getRetellClient().phoneNumber.list({ limit: 200, ...(key ? { pagination_key: key } : {}) });
        for (const n of res.items ?? []) {
          const bound = [...(n.inbound_agents ?? []), ...(n.outbound_agents ?? [])].some((a) => agentId && a.agent_id === agentId);
          const named = (n.nickname ?? "").includes(tag);
          const same = want !== null && n.phone_number.replace(/\D/g, "").slice(-10) === want;
          if (bound || named || same) found.add(n.phone_number);
        }
        key = res.pagination_key ?? undefined;
        if (!res.has_more || !key) break;
      }
      return [...found];
    },
    async retellAgentExists(id) {
      try {
        await getRetellClient().agent.retrieve(id);
        return true;
      } catch (err) {
        if (isGone(err)) return false;
        throw err;
      }
    },
    async retellLlmExists(id) {
      try {
        await getRetellClient().llm.retrieve(id);
        return true;
      } catch (err) {
        if (isGone(err)) return false;
        throw err;
      }
    },
    retellDeleteCall: (id) => gone(() => getRetellClient().call.delete(id)),
    async twilioNumberExists(sid) {
      try {
        await twilioClient().incomingPhoneNumbers(sid).fetch();
        return true;
      } catch (err) {
        if (isGone(err)) return false;
        throw err;
      }
    },
    async twilioNumbersNamed(friendlyName) {
      const nums = await twilioClient().incomingPhoneNumbers.list({ friendlyName, limit: 50 });
      // Never the shared sender, whatever it is called.
      return nums
        .filter((n) => n.friendlyName === friendlyName && n.phoneNumber !== env.TWILIO_FROM_NUMBER)
        .map((n) => ({ sid: n.sid, phone: n.phoneNumber }));
    },
    twilioDeleteTollfreeVerification: (sid) => gone(() => twilioClient().messaging.v1.tollfreeVerifications(sid).remove()),
    async stripeSubscriptionsByClient(clientId) {
      const out: string[] = [];
      const safe = clientId.replace(/[^a-zA-Z0-9-]/g, "");
      for await (const s of getStripe().subscriptions.search({ query: `metadata['clientId']:'${safe}'`, limit: 100 })) {
        if (s.status !== "canceled" && s.status !== "incomplete_expired") out.push(s.id);
      }
      return out;
    },
    async stripeWindDown({ clientId, customerId }) {
      const stripe = getStripe();
      const r: StripeWindDown = { schedulesCanceled: 0, invoicesVoided: 0, draftInvoicesDeleted: 0, pendingItemsRemoved: 0, checkoutsExpired: 0 };
      if (customerId) {
        for await (const sc of stripe.subscriptionSchedules.list({ customer: customerId, limit: 100 })) {
          if (sc.status === "active" || sc.status === "not_started") {
            await stripe.subscriptionSchedules.cancel(sc.id, { invoice_now: false, prorate: false });
            r.schedulesCanceled += 1;
          }
        }
        for await (const inv of stripe.invoices.list({ customer: customerId, status: "open", limit: 100 })) {
          await stripe.invoices.voidInvoice(inv.id as string);
          r.invoicesVoided += 1;
        }
        for await (const inv of stripe.invoices.list({ customer: customerId, status: "draft", limit: 100 })) {
          await stripe.invoices.del(inv.id as string);
          r.draftInvoicesDeleted += 1;
        }
        for await (const it of stripe.invoiceItems.list({ customer: customerId, pending: true, limit: 100 })) {
          await stripe.invoiceItems.del(it.id);
          r.pendingItemsRemoved += 1;
        }
      }
      // An unfinished Checkout can still turn into a subscription; close it.
      for await (const cs of stripe.checkout.sessions.list({ status: "open", limit: 100 })) {
        const mine = cs.metadata?.clientId === clientId || (customerId !== null && (typeof cs.customer === "string" ? cs.customer : cs.customer?.id) === customerId);
        if (!mine) continue;
        try {
          await stripe.checkout.sessions.expire(cs.id);
          r.checkoutsExpired += 1;
        } catch (err) {
          if (!isGone(err)) throw err;
        }
      }
      return r;
    },
    async stripeInventory({ clientId, customerId }) {
      const stripe = getStripe();
      const inv: StripeInventory = { activeSubscriptions: 0, openInvoices: 0, pendingItems: 0, activeSchedules: 0, openCheckouts: 0 };
      const subs = new Set<string>();
      const live = (status: string) => status !== "canceled" && status !== "incomplete_expired";
      if (customerId) {
        for await (const s of stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 })) if (live(s.status)) subs.add(s.id);
        for await (const _ of stripe.invoices.list({ customer: customerId, status: "open", limit: 100 })) inv.openInvoices += 1;
        for await (const _ of stripe.invoices.list({ customer: customerId, status: "draft", limit: 100 })) inv.openInvoices += 1;
        for await (const _ of stripe.invoiceItems.list({ customer: customerId, pending: true, limit: 100 })) inv.pendingItems += 1;
        for await (const sc of stripe.subscriptionSchedules.list({ customer: customerId, limit: 100 })) {
          if (sc.status === "active" || sc.status === "not_started") inv.activeSchedules += 1;
        }
      }
      const safe = clientId.replace(/[^a-zA-Z0-9-]/g, "");
      for await (const s of stripe.subscriptions.search({ query: `metadata['clientId']:'${safe}'`, limit: 100 })) if (live(s.status)) subs.add(s.id);
      inv.activeSubscriptions = subs.size;
      for await (const cs of stripe.checkout.sessions.list({ status: "open", limit: 100 })) {
        const cust = typeof cs.customer === "string" ? cs.customer : cs.customer?.id;
        if (cs.metadata?.clientId === clientId || (customerId !== null && cust === customerId)) inv.openCheckouts += 1;
      }
      return inv;
    },
    async revokeCalendar(provider, encryptedSecret) {
      if (!provider || !encryptedSecret) return "none";
      if (provider === "google") {
        let token: string | null = null;
        try {
          token = decryptSecret(encryptedSecret);
        } catch {
          return "manual"; // unreadable (rotated key): nothing to revoke with
        }
        return (await revokeGoogleToken(token)) ? "revoked" : "manual";
      }
      // Cal.com keys are the customer's own; Microsoft has no per-token revoke.
      return "manual";
    },

    /* ---- orphan listing (read-only) ---- */
    async listRetellAgents() {
      // GET /list-agents was removed by Retell on 2026-07-31; the unified POST /v2/list-agents
      // returns voice and chat agents together under `items`.
      const out = new Map<string, { id: string; name: string | null; modifiedAt: number | null }>();
      let key: string | undefined;
      for (let page = 0; page < 20; page++) {
        const res = await getRetellClient().post<{
          items?: { agent_id: string; agent_name?: string | null; channel?: string; user_modified_timestamp?: number | null }[];
          pagination_key?: string | null;
          has_more?: boolean;
        }>("/v2/list-agents", {
          query: { limit: 200, ...(key ? { pagination_key: key } : {}) },
          body: { filter_criteria: { channel: { type: "string", op: "eq", value: "voice" } } },
        });
        for (const a of res.items ?? []) {
          out.set(a.agent_id, { id: a.agent_id, name: a.agent_name ?? null, modifiedAt: a.user_modified_timestamp ?? null });
        }
        key = res.pagination_key ?? undefined;
        if (!res.has_more || !key) break;
      }
      return [...out.values()];
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
