"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireAgencyOperator } from "@/lib/auth-guard";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * Operator-only: turn "every signup lands on my agency dashboard" on or off.
 * Default is ON. When off, new self-serve signups bootstrap their own isolated
 * workspace instead of appearing under the operator's agency.
 */
export async function setAutoAttachSignupsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAgencyOperator();
  const enabled = String(formData.get("enabled") ?? "") === "true";

  await db
    .update(organizations)
    .set({ autoAttachSignups: enabled })
    .where(eq(organizations.id, user.orgId));

  logger.info("signups.auto_attach_toggled", { orgId: user.orgId, enabled });
  revalidatePath("/settings");
  return {
    ok: true,
    message: enabled
      ? "New signups will appear on your dashboard automatically."
      : "New signups will get their own separate workspace — you won't see them here.",
  };
}
