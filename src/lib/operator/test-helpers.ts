import { vi, type Mock } from "vitest";
import type { ControlClient, ControlDeps, ControlStore, OperatorProviders, Outcome, RemainingRows, ScheduledWork, StripeInventory, StripeWindDown } from "./controls";
import type { BlockedIdentity } from "./trial-block";

type Mocked<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? Mock<(...a: A) => R> : T[K] };

/** In-memory ControlStore + mocked providers: the whole operator toolkit with zero network or database. */
export function makeWorld(over: Partial<ControlClient> = {}, opts: { sub?: boolean; tollfree?: boolean } = {}) {
  const client: ControlClient = {
    id: "c1",
    orgId: "org1",
    name: "Bright Smile Dental",
    status: "live",
    deletedAt: null,
    retellAgentId: "agent_1",
    retellLlmId: "llm_1",
    retellPhoneNumber: "+12272382281",
    smsNumber: null,
    ownerEmail: "Pat@brightsmile.example",
    calendarProvider: null,
    calendarSecret: null,
    setupFlags: {},
    ...over,
  };
  const sub =
    opts.sub === false
      ? null
      : { stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "active" as string | null };
  const tf = opts.tollfree ? { phoneNumber: "+18885551234", phoneNumberSid: "PN1" } : null;
  const work: ScheduledWork = { queuedTexts: 3, queuedReminders: 2, pendingCallbacks: 1, waitingWaitlist: 1, pushSubscriptions: 1 };
  const db = { rows: { client: 1, calls: 12, leads: 4, messages: 30, knowledge: 6, appointments: 5, users: 2, subscriptions: sub ? 1 : 0, other: 9 } as RemainingRows };
  // What the vendors hold. The mocks mutate this, and the verification step re-reads it,
  // so a test that "forgets" a resource fails the way production would.
  const vendor = {
    retellNumbers: new Set<string>(client.retellPhoneNumber ? [client.retellPhoneNumber] : []),
    retellAgents: new Set<string>(client.retellAgentId ? [client.retellAgentId] : []),
    retellLlms: new Set<string>(client.retellLlmId ? [client.retellLlmId] : []),
    twilioNumbers: new Map<string, string>(tf?.phoneNumberSid ? [[tf.phoneNumberSid, tf.phoneNumber ?? ""]] : []),
    stripeSubs: new Set<string>(sub?.stripeSubscriptionId ? [sub.stripeSubscriptionId] : []),
    stripe: { openInvoices: 0, pendingItems: 0, schedules: 0, checkouts: 0 },
    calls: [] as string[],
  };
  const state = { client, sub, tf, queued: 3, work, db, vendor, audits: [] as { action: string; detail: Record<string, unknown>; clientId: string | null }[], blocks: [] as BlockedIdentity[] };

  const store: ControlStore = {
    getClient: vi.fn(async () => ({ ...state.client, setupFlags: { ...(state.client.setupFlags ?? {}) } })),
    patchClient: vi.fn(async (_id, patch) => {
      Object.assign(state.client, patch);
    }),
    mergeFlags: vi.fn(async (_id, set, remove = []) => {
      const flags: Record<string, unknown> = { ...(state.client.setupFlags ?? {}), ...set };
      for (const k of remove) delete flags[k];
      state.client.setupFlags = flags as ControlClient["setupFlags"];
    }),
    getSubscription: vi.fn(async () => state.sub),
    markSubscriptionStatus: vi.fn(async (_id, status) => {
      if (state.sub) state.sub.status = status;
    }),
    getTollfree: vi.fn(async () => state.tf),
    clearTollfree: vi.fn(async () => {
      state.tf = null;
    }),
    dropQueuedTexts: vi.fn(async () => {
      const n = state.queued;
      state.queued = 0;
      return n;
    }),
    identitiesFor: vi.fn(async () => ({ emails: ["owner2@brightsmile.example"], phones: ["+1 (415) 555-0100"] })),
    isFreeEmailDomain: (d: string) => d === "gmail.com",
    writeTrialBlock: vi.fn(async (_id, identity) => {
      state.blocks.push(identity);
    }),
    audit: vi.fn(async (e) => {
      state.audits.push({ action: e.action, detail: e.detail, clientId: e.clientId });
    }),
    cancelScheduledWork: vi.fn(async () => {
      const done = { ...state.work };
      state.work = { queuedTexts: 0, queuedReminders: 0, pendingCallbacks: 0, waitingWaitlist: 0, pushSubscriptions: 0 };
      return done;
    }),
    pendingWork: vi.fn(async () => ({ ...state.work })),
    listRetellCallIds: vi.fn(async () => ["call_1", "call_2"]),
    purgeBusiness: vi.fn(async () => {
      state.db.rows = { client: 0, calls: 0, leads: 0, messages: 0, knowledge: 0, appointments: 0, users: 0, subscriptions: 0, other: 0 };
      return state.db.rows;
    }),
    remainingRows: vi.fn(async () => ({ ...state.db.rows })),
  };

  const gone = (set: Set<string>, key: string): Outcome => (set.delete(key) ? "done" : "already_gone");
  const providers = {
    configured: { retell: true as boolean, stripe: true as boolean, twilio: true as boolean },
    retellUnbindNumber: vi.fn(async () => "done" as Outcome),
    retellRebindNumber: vi.fn(async () => "done" as Outcome),
    retellReleaseNumber: vi.fn(async (phone: string) => gone(vendor.retellNumbers, phone)),
    retellDeleteAgent: vi.fn(async (id: string) => gone(vendor.retellAgents, id)),
    retellDeleteLlm: vi.fn(async (id: string) => gone(vendor.retellLlms, id)),
    twilioReleaseNumber: vi.fn(async (sid: string) => {
      const had = vendor.twilioNumbers.delete(sid);
      return (had ? "done" : "already_gone") as Outcome;
    }),
    stripeCancel: vi.fn(async (id: string) => gone(vendor.stripeSubs, id)),
    stripeOpenSubscriptionsFor: vi.fn(async () => [...vendor.stripeSubs]),
    stripePause: vi.fn(async () => "done" as Outcome),
    stripeResume: vi.fn(async () => "resumed" as const),
    republishAgent: vi.fn(async () => undefined),

    retellNumbersFor: vi.fn(async () => [...vendor.retellNumbers]),
    retellAgentExists: vi.fn(async (id: string) => vendor.retellAgents.has(id)),
    retellLlmExists: vi.fn(async (id: string) => vendor.retellLlms.has(id)),
    retellDeleteCall: vi.fn(async (id: string) => {
      vendor.calls.push(id);
      return "done" as Outcome;
    }),
    twilioNumberExists: vi.fn(async (sid: string) => vendor.twilioNumbers.has(sid)),
    twilioNumbersNamed: vi.fn(async () => [...vendor.twilioNumbers].map(([sid, phone]) => ({ sid, phone }))),
    twilioDeleteTollfreeVerification: vi.fn(async () => "done" as Outcome),
    stripeSubscriptionsByClient: vi.fn(async () => [] as string[]),
    stripeWindDown: vi.fn(async (): Promise<StripeWindDown> => {
      const r = {
        schedulesCanceled: vendor.stripe.schedules,
        invoicesVoided: vendor.stripe.openInvoices,
        draftInvoicesDeleted: 0,
        pendingItemsRemoved: vendor.stripe.pendingItems,
        checkoutsExpired: vendor.stripe.checkouts,
      };
      vendor.stripe = { openInvoices: 0, pendingItems: 0, schedules: 0, checkouts: 0 };
      return r;
    }),
    stripeInventory: vi.fn(
      async (): Promise<StripeInventory> => ({
        activeSubscriptions: vendor.stripeSubs.size,
        openInvoices: vendor.stripe.openInvoices,
        pendingItems: vendor.stripe.pendingItems,
        activeSchedules: vendor.stripe.schedules,
        openCheckouts: vendor.stripe.checkouts,
      }),
    ),
    revokeCalendar: vi.fn(async () => "revoked" as "revoked" | "none" | "manual"),
  } satisfies OperatorProviders;

  const deps: ControlDeps = { providers, store, now: () => new Date("2026-11-27T12:00:00Z") };
  return { state, store: store as unknown as Mocked<ControlStore>, providers, deps };
}

export const actor = { id: "user_ari", email: "ari@example.com" };
