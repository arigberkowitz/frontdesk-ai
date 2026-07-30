"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { assertClientAccess, grantEditUnlock } from "@/lib/auth-guard";
import { hashEditCode, verifyEditCode } from "@/lib/crypto";
import { assertClientInOrg } from "@/lib/data/clients";
import { logger } from "@/lib/logger";
import { clearAttempts, consumeAttempt, formatRetryAfter } from "@/lib/rate-limit";
import { type ActionState } from "./types";

/** Staff enters the admin's code → 12h editing unlock (signed cookie). */
export async function unlockEditingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);
  if (!code) return { ok: false, error: "Enter the edit code." };

  // The edit code is short and hand-typed, so an unlocked-out staff account
  // could otherwise just loop this action until it guesses. Throttle per
  // user+client (see rate-limit.ts for the honest limits of this).
  const throttleKey = `editcode:${clientId}:${user.id}`;
  const gate = consumeAttempt(throttleKey);
  if (!gate.ok) {
    logger.warn("editlock.throttled", { clientId, userId: user.id });
    return {
      ok: false,
      error: `Too many incorrect codes. Try again in ${formatRetryAfter(gate.retryAfterSec)}.`,
    };
  }

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { editCodeHash: true },
  });
  if (!client?.editCodeHash) {
    return { ok: false, error: "Your admin hasn't set an edit code yet." };
  }
  if (!verifyEditCode(clientId, code, client.editCodeHash)) {
    logger.warn("editlock.bad_code", { clientId, userId: user.id });
    return { ok: false, error: "That code isn't right — check with your admin." };
  }

  clearAttempts(throttleKey);
  await grantEditUnlock(clientId, user.id);
  revalidatePath("/portal", "layout");
  return { ok: true, message: "Editing unlocked for 12 hours." };
}

/** Admin sets (or clears) the edit code staff can use to unlock editing. */
export async function setEditCodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const user = await assertClientAccess(clientId);
  await assertClientInOrg(user.orgId, clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your admin can change the edit code." };
  }
  if (code && (code.length < 4 || code.length > 40)) {
    return { ok: false, fieldErrors: { code: ["Use 4–40 characters."] } };
  }

  await db
    .update(clients)
    .set({ editCodeHash: code ? hashEditCode(clientId, code) : null })
    .where(eq(clients.id, clientId));
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message: code
      ? "Edit code saved — share it with staff you trust to make changes."
      : "Edit code cleared — staff editing is now off.",
  };
}
