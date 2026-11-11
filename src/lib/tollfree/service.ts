import type { ClientTollfree } from "@/db/schema";
import type { TollfreeStore } from "@/lib/data/tollfree";
import { fieldErrorsOf } from "@/lib/actions/types";
import { tollfreeDetailsSchema, type TollfreeDetails } from "./details";
import { buildVerificationPayload } from "./payload";
import { rejectionText, stateFromTwilio } from "./status";
import type { TollfreeApi, VerificationRecord } from "./twilio-api";

/**
 * Toll-free texting lifecycle for one business:
 *
 *   setup finished AND paid → buy number once (needs_details) → owner submits details (submitted)
 *        → Twilio approves (approved: the number becomes clients.sms_number)
 *        → or rejects (rejected: owner fixes details and resubmits)
 *
 * Every side effect goes through `deps`, so tests run with mocks only. With
 * `enabled` false every entry point is a no-op.
 */
export interface TollfreeDeps {
  enabled: boolean;
  api: TollfreeApi;
  store: TollfreeStore;
  appUrl: string;
  notificationEmail: string;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Buy this business a toll-free number — at most once, and only once it has
 * finished setup AND has an active (paying) subscription AND has no texting
 * number yet. A trial does not count; the buy happens when the trial converts
 * to paid (or they pay up front). Called from both the Stripe webhook (payment
 * / trial→active) and "I'm done" on the setup checklist; whichever happens
 * second (once they're actually paying) does the buy.
 * Safe to call any number of times, concurrently: the store's atomic claim
 * (`claimBuy`) is the guard, not this function's reads.
 */
export async function ensureTollfreeNumber(deps: TollfreeDeps, clientId: string): Promise<ClientTollfree | null> {
  if (!deps.enabled) return null;
  const row = await deps.store.get(clientId);
  if (row?.phoneNumberSid) return row;
  const client = await deps.store.client(clientId);
  if (!client) return null;
  if (!(await deps.store.claimBuy(clientId))) {
    deps.log?.("tollfree.number.not_eligible", { clientId });
    return row;
  }
  let bought: { phoneNumber: string; sid: string };
  try {
    bought = await deps.api.buyNumber(`FrontDesk SMS · ${client.name}`.slice(0, 64));
  } catch (err) {
    await deps.store.save(clientId, { status: row?.status ?? "needs_number", lastError: msg(err) });
    await deps.store.releaseBuy(clientId);
    deps.log?.("tollfree.number.failed", { clientId, error: msg(err) });
    return deps.store.get(clientId);
  }
  try {
    await deps.store.save(clientId, {
      status: "needs_details",
      phoneNumber: bought.phoneNumber,
      phoneNumberSid: bought.sid,
      lastError: null,
    });
  } catch (err) {
    // Bought but not recorded: keep the lock (don't invite a second buy) and
    // shout, with the sid, so it can be fixed by hand.
    deps.log?.("tollfree.number.bought_not_saved", { clientId, phoneNumberSid: bought.sid, error: msg(err) });
    throw err;
  }
  await deps.store.releaseBuy(clientId);
  deps.log?.("tollfree.number.bought", { clientId });
  // Details entered before the number arrived: submit now.
  const fresh = await deps.store.get(clientId);
  if (fresh?.details) {
    const parsed = tollfreeDetailsSchema.safeParse(fresh.details);
    if (parsed.success) await submit(deps, clientId, parsed.data, fresh);
  }
  return deps.store.get(clientId);
}

export type SaveDetailsResult =
  | { ok: true; state: string }
  | { ok: false; fieldErrors?: Record<string, string[]>; error?: string };

/** The owner saved (or corrected) their details in Settings. */
export async function saveTollfreeDetails(
  deps: TollfreeDeps,
  clientId: string,
  raw: Record<string, string>,
): Promise<SaveDetailsResult> {
  if (!deps.enabled) return { ok: false, error: "Toll-free texting isn't turned on yet." };
  const row = await deps.store.get(clientId);
  // The EIN is never sent back to the browser, so a blank field means "keep the one on file".
  const stored = row?.details?.ein ?? "";
  const merged = !raw.ein?.trim() && stored && raw.businessType !== "SOLE_PROPRIETOR" ? { ...raw, ein: stored } : raw;
  const parsed = tollfreeDetailsSchema.safeParse(merged);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  if (row?.status === "submitted" || row?.status === "approved") {
    return { ok: false, error: "Your details are already with the carriers." };
  }
  await deps.store.save(clientId, { details: parsed.data as unknown as Record<string, string> });
  if (!row?.phoneNumberSid) return { ok: true, state: "needs_number" };
  const after = await submit(deps, clientId, parsed.data, row);
  return after === "error" ? { ok: false, error: "Couldn't submit to the carriers. Try again in a moment." } : { ok: true, state: after };
}

async function submit(
  deps: TollfreeDeps,
  clientId: string,
  details: TollfreeDetails,
  row: ClientTollfree,
): Promise<string> {
  const client = await deps.store.client(clientId);
  const payload = buildVerificationPayload({
    details,
    clientId,
    displayName: client?.name ?? details.legalName,
    phoneNumberSid: row.phoneNumberSid!,
    appUrl: deps.appUrl,
    notificationEmail: deps.notificationEmail,
  });
  try {
    const canEdit = row.verificationSid && row.status === "rejected" && row.editAllowed !== false;
    const v = canEdit ? await deps.api.resubmit(row.verificationSid!, payload) : await deps.api.submit(payload);
    await apply(deps, clientId, v, { submittedAt: new Date() });
    deps.log?.("tollfree.verification.submitted", { clientId, resubmit: Boolean(canEdit) });
    return stateFromTwilio(v.status);
  } catch (err) {
    await deps.store.save(clientId, { status: "error", lastError: msg(err) });
    deps.log?.("tollfree.verification.submit_failed", { clientId, error: msg(err) });
    return "error";
  }
}

async function apply(
  deps: TollfreeDeps,
  clientId: string,
  v: VerificationRecord,
  extra: Partial<ClientTollfree> = {},
): Promise<void> {
  const state = stateFromTwilio(v.status);
  const now = new Date();
  await deps.store.save(clientId, {
    ...extra,
    status: state,
    verificationSid: v.sid,
    twilioStatus: v.status,
    checkedAt: now,
    lastError: null,
    rejectionReason: state === "rejected" ? rejectionText(v) : null,
    editAllowed: v.editAllowed ?? null,
    ...(state === "approved" ? { approvedAt: now } : {}),
  });
  if (state === "approved") {
    const row = await deps.store.get(clientId);
    // Only now do texts leave from the toll-free number. Until approval the
    // business keeps whatever it sent from before (and SMS_ENABLED gating).
    if (row?.phoneNumber) await deps.store.useAsSmsNumber(clientId, row.phoneNumber);
  }
}

/** Re-read one verification from Twilio (the source of truth) and store it. */
export async function refreshTollfree(deps: TollfreeDeps, row: ClientTollfree): Promise<string> {
  if (!deps.enabled || !row.verificationSid) return row.status;
  const v = await deps.api.fetch(row.verificationSid);
  await apply(deps, row.clientId, v);
  return stateFromTwilio(v.status);
}

/** Event Streams webhook: we only take the sid from the event, then re-fetch. */
export async function handleTollfreeEvent(deps: TollfreeDeps, verificationSid: string): Promise<string | null> {
  if (!deps.enabled || !/^HH[0-9a-f]{32}$/i.test(verificationSid)) return null;
  const row = await deps.store.byVerificationSid(verificationSid);
  if (!row) return null;
  return refreshTollfree(deps, row);
}

/** Daily cron: catch anything the webhook missed. */
export async function pollTollfree(deps: TollfreeDeps): Promise<{ checked: number; failed: number }> {
  if (!deps.enabled) return { checked: 0, failed: 0 };
  let checked = 0;
  let failed = 0;
  for (const row of await deps.store.listSubmitted()) {
    try {
      await refreshTollfree(deps, row);
      checked++;
    } catch (err) {
      failed++;
      deps.log?.("tollfree.poll.failed", { clientId: row.clientId, error: msg(err) });
    }
  }
  return { checked, failed };
}

/** Pull verification sids out of an Event Streams delivery (an array of CloudEvents). */
export function sidsFromEvents(body: unknown): string[] {
  const events = Array.isArray(body) ? body : [body];
  const sids = events
    .map((e) => (e as { data?: { tollfreeverificationsid?: unknown } })?.data?.tollfreeverificationsid)
    .filter((s): s is string => typeof s === "string");
  return [...new Set(sids)];
}
