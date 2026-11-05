"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { toE164 } from "@/lib/format";
import { applyClientEdit, withSyncNote } from "@/lib/agent-publish";
import { type ActionState } from "./types";

/**
 * Emergencies: put a genuine emergency straight through to an on-call number
 * at any hour, or (off) take an urgent message and alert the owner at once.
 */
export async function setEmergencyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const transfer247 = formData.get("transfer247") !== null;
  const rawNumber = String(formData.get("onCallNumber") ?? "").trim();
  const onCallNumber = rawNumber ? toE164(rawNumber) : null;
  if (rawNumber && !onCallNumber)
    return { ok: false, fieldErrors: { onCallNumber: ["That doesn't look like a phone number."] } };

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { setupFlags: true, escalationNumber: true },
  });
  if (transfer247 && !onCallNumber && !client?.escalationNumber)
    return {
      ok: false,
      fieldErrors: { onCallNumber: ["Add the on-call number emergencies should ring."] },
    };

  await db
    .update(clients)
    .set({ setupFlags: { ...(client?.setupFlags ?? {}), emergency: { transfer247, onCallNumber } } })
    .where(eq(clients.id, clientId));
  void audit({
    clientId,
    actor: guard.user.id,
    action: "emergency.set",
    detail: { transfer247, hasOnCallNumber: Boolean(onCallNumber) },
  });
  const sync = await applyClientEdit(guard.user, clientId);
  revalidatePath("/portal/settings", "layout");
  const message = transfer247
    ? "Emergencies will be put straight through to your on-call number, day or night."
    : "Emergencies: your AI takes an urgent message and texts and emails you right away.";
  return { ok: true, message: withSyncNote(message, sync) };
}

/** Flat trip / service-call fee the AI mentions when booking a visit. Empty = none. */
export async function setTripFeeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const raw = String(formData.get("tripFeeDollars") ?? "").trim();
  const dollars = raw ? Number(raw) : null;
  if (dollars != null && (!Number.isFinite(dollars) || dollars < 0 || dollars > 5000))
    return { ok: false, fieldErrors: { tripFeeDollars: ["Enter an amount between $0 and $5,000."] } };

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  const tripFeeCents = dollars ? Math.round(dollars * 100) : null;
  await db.update(clients).set({ tripFeeCents }).where(eq(clients.id, clientId));
  void audit({ clientId, actor: guard.user.id, action: "trip_fee.set", detail: { tripFeeCents } });
  const sync = await applyClientEdit(guard.user, clientId);
  revalidatePath("/portal/services");
  return {
    ok: true,
    message: withSyncNote(tripFeeCents ? "Trip fee saved." : "Trip fee removed.", sync),
  };
}
