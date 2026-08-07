"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { addBlocked, MAX_BLOCKED, normalizeForBlock, removeBlocked } from "@/lib/spam";
import { formatPhone } from "@/lib/format";
import { logger } from "@/lib/logger";
import { applyClientEdit, withSyncNote } from "@/lib/agent-publish";
import { type ActionState } from "./types";

/**
 * Block and unblock callers.
 *
 * A blocked number still reaches the phone line — we don't control the carrier
 * — but from that point on it is treated as noise: the agent is told to end the
 * call immediately, no lead is created, no alert is sent, and it never enters
 * the numbers the business is asked to trust.
 */

async function loadBlocked(clientId: string): Promise<string[]> {
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    columns: { setupFlags: true },
  });
  return client?.setupFlags?.blockedNumbers ?? [];
}

async function saveBlocked(clientId: string, blocked: string[]): Promise<void> {
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { setupFlags: true },
  });
  await db
    .update(clients)
    .set({ setupFlags: { ...(client?.setupFlags ?? {}), blockedNumbers: blocked } })
    .where(eq(clients.id, clientId));
}

export async function blockNumberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  if (!normalizeForBlock(phone)) {
    return { ok: false, error: "That doesn't look like a number we can block." };
  }

  const current = await loadBlocked(clientId);
  if (current.length >= MAX_BLOCKED) {
    return {
      ok: false,
      error: `You can block up to ${MAX_BLOCKED} numbers. Remove one first, or tell us — this many usually means something else is wrong.`,
    };
  }

  await saveBlocked(clientId, addBlocked(phone, current));
  void audit({ clientId, actor: guard.user.id, action: "caller.blocked", detail: { phone: normalizeForBlock(phone) } });
  logger.info("spam.blocked", { clientId, phone: normalizeForBlock(phone) });
  revalidatePath("/portal");
  revalidatePath("/portal/calls");
  revalidatePath("/portal/settings");
  return { ok: true, message: `${formatPhone(phone)} is blocked. Your AI won't talk to them again.` };
}

export async function unblockNumberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  await saveBlocked(clientId, removeBlocked(phone, await loadBlocked(clientId)));
  void audit({ clientId, actor: guard.user.id, action: "caller.unblocked", detail: { phone: normalizeForBlock(phone) } });
  logger.info("spam.unblocked", { clientId, phone: normalizeForBlock(phone) });
  revalidatePath("/portal");
  revalidatePath("/portal/settings");
  return { ok: true, message: `${formatPhone(phone)} can get through again.` };
}

/**
 * When the AI may connect a caller to a person.
 *
 * Its own action rather than part of the settings form, because it's the one
 * setting whose wrong value produces the worst call this product can make: a
 * caller who asked for a human, was told "one moment", and got an answering
 * machine at eleven at night.
 */
export async function setHandoffModeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const raw = String(formData.get("mode") ?? "");
  const mode = raw === "never" || raw === "open_hours" || raw === "always" ? raw : null;
  if (!mode) return { ok: false, error: "Pick one of the three options." };

  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { setupFlags: true },
  });
  await db
    .update(clients)
    .set({ setupFlags: { ...(client?.setupFlags ?? {}), handoffMode: mode } })
    .where(eq(clients.id, clientId));

  void audit({
    clientId,
    actor: guard.user.id,
    action: "handoff.set",
    detail: { mode, previous: client?.setupFlags?.handoffMode ?? "always" },
  });
  // The rule lives in the published prompt as well as in our transfer endpoint,
  // so a change is only real once the agent has it.
  const sync = await applyClientEdit(guard.user, clientId);
  revalidatePath("/portal/settings");
  revalidatePath("/portal");

  const message =
    mode === "never"
      ? "Your AI will take a message instead of transferring anyone."
      : mode === "open_hours"
        ? "Your AI will only put callers through during your opening hours."
        : "Your AI will put callers through whenever they ask.";
  return { ok: true, message: withSyncNote(message, sync) };
}
