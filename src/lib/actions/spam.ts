"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { addBlocked, MAX_BLOCKED, normalizeForBlock, removeBlocked } from "@/lib/spam";
import { formatPhone } from "@/lib/format";
import { logger } from "@/lib/logger";
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
  logger.info("spam.unblocked", { clientId, phone: normalizeForBlock(phone) });
  revalidatePath("/portal");
  revalidatePath("/portal/settings");
  return { ok: true, message: `${formatPhone(phone)} can get through again.` };
}
