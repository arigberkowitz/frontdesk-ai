"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { assertClientAccess } from "@/lib/auth-guard";
import { syncAgentPrompt } from "@/lib/agent-publish";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

/**
 * Portal power switch: the business admin can turn the WHOLE receptionist off
 * (paused — the number answers with a brief message-only greeting, no booking,
 * no FAQ answers, and the background agents skip it) and back on with one
 * click. Resume restores trial/live based on the trial clock.
 */
export async function setReceptionistPowerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const turnOn = String(formData.get("power") ?? "") === "on";
  const user = await assertClientAccess(clientId);
  if (user.role !== "operator" && user.role !== "client_admin") {
    return { ok: false, error: "Only your admin can turn the receptionist on or off." };
  }

  const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
  if (!client) return { ok: false, error: "Business not found." };

  if (turnOn) {
    if (client.status !== "paused") return { ok: true, message: "Already on." };
    const resumed =
      client.trialEndsAt && client.trialEndsAt.getTime() > Date.now() ? "trial" : "live";
    await db.update(clients).set({ status: resumed }).where(eq(clients.id, clientId));
  } else {
    if (client.status === "paused") return { ok: true, message: "Already off." };
    if (client.status === "draft") {
      return { ok: false, error: "Your receptionist isn't live yet — nothing to turn off." };
    }
    await db.update(clients).set({ status: "paused" }).where(eq(clients.id, clientId));
  }

  // Push the matching behavior to the live phone agent immediately.
  try {
    await syncAgentPrompt(client.orgId, clientId);
  } catch (err) {
    logger.warn("receptionist.power.sync_failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("receptionist.power", { clientId, on: turnOn });
  revalidatePath("/portal", "layout");
  revalidatePath(`/clients/${clientId}`);
  return turnOn
    ? { ok: true, message: "Receptionist is back on — answering, booking, and alerting as before." }
    : {
        ok: true,
        message:
          "Receptionist turned off. Callers hear a brief message and can leave their name and number; nothing else runs until you turn it back on.",
      };
}
