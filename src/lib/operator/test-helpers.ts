import { vi } from "vitest";
import type { ControlClient, ControlDeps, ControlStore, OperatorProviders, Outcome } from "./controls";
import type { BlockedIdentity } from "./trial-block";

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
    setupFlags: {},
    ...over,
  };
  const sub =
    opts.sub === false
      ? null
      : { stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1", status: "active" as string | null };
  const tf = opts.tollfree ? { phoneNumber: "+18885551234", phoneNumberSid: "PN1" } : null;
  const state = { client, sub, tf, queued: 3, audits: [] as { action: string; detail: Record<string, unknown>; clientId: string | null }[], blocks: [] as BlockedIdentity[] };

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
  };

  const providers = {
    configured: { retell: true as boolean, stripe: true as boolean, twilio: true as boolean },
    retellUnbindNumber: vi.fn(async () => "done" as Outcome),
    retellRebindNumber: vi.fn(async () => "done" as Outcome),
    retellReleaseNumber: vi.fn(async () => "done" as Outcome),
    retellDeleteAgent: vi.fn(async () => "done" as Outcome),
    retellDeleteLlm: vi.fn(async () => "done" as Outcome),
    twilioReleaseNumber: vi.fn(async () => "done" as Outcome),
    stripeCancel: vi.fn(async () => "done" as Outcome),
    stripeOpenSubscriptionsFor: vi.fn(async () => ["sub_1"]),
    stripePause: vi.fn(async () => "done" as Outcome),
    stripeResume: vi.fn(async () => "resumed" as const),
    republishAgent: vi.fn(async () => undefined),
  } satisfies OperatorProviders;

  const deps: ControlDeps = { providers, store, now: () => new Date("2026-11-27T12:00:00Z") };
  return { state, store, providers, deps };
}

export const actor = { id: "user_ari", email: "ari@example.com" };
