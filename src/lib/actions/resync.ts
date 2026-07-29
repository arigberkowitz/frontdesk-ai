"use server";

import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireAgencyOperator } from "@/lib/auth-guard";
import { syncAgentPrompt } from "@/lib/agent-publish";
import { mapLimit } from "@/lib/agents/util";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * Operator-only backfill: rebuild and push the latest prompt rules + tools to
 * EVERY provisioned agent in the org. Run after shipping prompt/tool
 * improvements so existing clients get them without waiting for their next
 * edit.
 */
export async function resyncAllAgentsAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const user = await requireAgencyOperator();

  const rows = await db.query.clients.findMany({
    where: and(
      eq(clients.orgId, user.orgId),
      isNull(clients.deletedAt),
      isNotNull(clients.retellLlmId),
    ),
    columns: { id: true, name: true },
  });
  if (rows.length === 0) {
    return { ok: true, message: "No provisioned agents to update yet." };
  }

  let synced = 0;
  const failed: string[] = [];
  await mapLimit(rows, 3, async (c) => {
    try {
      if (await syncAgentPrompt(user.orgId, c.id)) synced++;
    } catch (err) {
      failed.push(c.name);
      logger.warn("resync.failed", {
        clientId: c.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  logger.info("resync.done", { orgId: user.orgId, synced, failed: failed.length });
  return failed.length === 0
    ? { ok: true, message: `Updated ${synced} live agent${synced === 1 ? "" : "s"} with the latest improvements.` }
    : {
        ok: false,
        error: `Updated ${synced}, but these failed: ${failed.join(", ")}. Try again in a minute.`,
      };
}
