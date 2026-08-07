import "server-only";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { logger } from "./../logger";

/**
 * Write a receipt. Best-effort, everywhere, always.
 *
 * Auditing must never be the reason an action fails: a handoff-mode change
 * that succeeded but couldn't be logged is a missing receipt; a handoff-mode
 * change that FAILED because logging hiccuped is a broken product. So this
 * swallows its own errors, loudly, and callers never await-and-check it.
 */
export async function audit(input: {
  clientId?: string | null;
  actor: string;
  action: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      clientId: input.clientId ?? null,
      actor: input.actor,
      action: input.action,
      detail: input.detail ?? null,
    });
  } catch (err) {
    logger.error("audit.write_failed", {
      action: input.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
