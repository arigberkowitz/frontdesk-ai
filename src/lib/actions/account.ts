"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { audit } from "@/lib/data/audit";
import { assertClientAccess } from "@/lib/auth-guard";
import { assertClientInOrg, softDeleteClient } from "@/lib/data/clients";
import { syncAgentPrompt } from "@/lib/agent-publish";
import { RETENTION_DAYS } from "@/lib/retention";
import { notifier } from "@/lib/notifier";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { confirmationMatches } from "@/lib/account-close";
import { type ActionState } from "./types";

/**
 * Close the account and schedule the data for deletion.
 *
 * The privacy policy has promised since day one that customers "can exercise
 * these directly in the product," and there was no way to. Only the operator
 * could delete a business, from a screen no customer can reach — so the honest
 * reading was that leaving required emailing a stranger and trusting him. That
 * is the kind of thing a buyer's lawyer finds.
 *
 * Two things have to happen together, and only one of them is the database
 * row. Marking a client deleted does not stop the phone: the Retell agent keeps
 * answering that line and keeps booking appointments into a calendar nobody is
 * reading any more. So the agent is paused FIRST and the delete only records
 * once the line is quiet.
 *
 * Deletion is deferred, not immediate, and the copy says so. The 90-day window
 * is the same one `retention.ts` already enforces and the same one §7 of the
 * privacy policy commits to — it exists so a business that closes by accident
 * on Friday can be restored on Monday, which is a favour worth more than the
 * theatre of an instant wipe.
 */
export async function closeAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const typed = String(formData.get("confirm") ?? "");

  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your account admin can close the account." };
  }
  await assertClientInOrg(user.orgId, clientId);

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return { ok: false, error: "Business not found." };
  if (client.deletedAt) {
    return { ok: true, message: "This account is already closed." };
  }
  if (!confirmationMatches(typed, client.name)) {
    return {
      ok: false,
      fieldErrors: { confirm: [`Type “${client.name}” exactly to confirm.`] },
    };
  }

  // Quiet the line before recording the close. If this throws we stop: an
  // account marked deleted whose AI is still answering and booking is worse
  // than an account that failed to close and said so.
  try {
    await db.update(clients).set({ status: "paused" }).where(eq(clients.id, clientId));
    await syncAgentPrompt(client.orgId, clientId);
  } catch (err) {
    logger.error("account.close.agent_stop_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error:
        "We couldn't stop your AI receptionist just now, so we haven't closed the account — closing it while the line is still answering would leave callers booking into a calendar nobody reads. Please try again in a minute, or contact support and we'll finish it by hand.",
    };
  }

  await softDeleteClient(user.orgId, clientId);

  logger.info("account.closed", { clientId, actor: user.id });
  void audit({ clientId, actor: user.id, action: "account.closed", detail: { by: user.email } });

  // Tell the operator a customer left. Churn you find out about 90 days later,
  // when the purge job deletes the row, is churn you could never have called
  // about.
  void notifier.sendEmail({
    to: env.ALERT_EMAIL,
    subject: `Account closed — ${client.name}`,
    text: `${client.name} closed their FrontDesk AI account.\n\nClosed by: ${user.email}\nStatus before closing: ${client.status}\nData is scheduled for permanent deletion in ${RETENTION_DAYS} days and can be restored until then by clearing deleted_at.`,
  });

  revalidatePath("/portal", "layout");
  revalidatePath(`/clients/${clientId}`);
  return {
    ok: true,
    message: `Account closed. Your receptionist has stopped answering, and your data will be permanently deleted in ${RETENTION_DAYS} days — email support before then if you want it back.`,
  };
}
