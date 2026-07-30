"use server";

import { revalidatePath } from "next/cache";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg, updateClient } from "@/lib/data/clients";
import { applyClientEdit } from "@/lib/agent-publish";
import { encryptSecret } from "@/lib/crypto";
import { type ActionState } from "./types";

/**
 * Connect a Cal.com calendar (the universal bridge — Cal.com itself syncs with
 * Outlook/Microsoft 365, Apple, and Google on the business's side).
 */
export async function connectCalcomAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const eventTypeId = String(formData.get("eventTypeId") ?? "").trim();
  if (!apiKey || apiKey.length > 300) {
    return { ok: false, fieldErrors: { apiKey: ["Paste your Cal.com API key"] } };
  }
  if (eventTypeId && !/^\d+$/.test(eventTypeId)) {
    return { ok: false, fieldErrors: { eventTypeId: ["Event type ID is a number"] } };
  }

  await updateClient(user.orgId, clientId, {
    calendarProvider: "calcom",
    calendarSecret: encryptSecret(apiKey),
    calendarId: eventTypeId || null,
    calendarAccount: "Cal.com",
    calendarConnectedAt: new Date(),
  });
  // Booking just became possible — republish so the agent starts offering it.
  await applyClientEdit(user, clientId);
  revalidatePath("/portal", "layout");
  return { ok: true, message: "Cal.com connected — your AI can now book appointments." };
}

/** Disconnect whatever calendar is attached; the agent reverts to message-taking. */
export async function disconnectCalendarAction(formData: FormData): Promise<void> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return; // locked staff: silent no-op (banner explains)
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);
  await updateClient(user.orgId, clientId, {
    calendarProvider: null,
    calendarSecret: null,
    calendarId: null,
    calendarAccount: null,
    calendarConnectedAt: null,
  });
  await applyClientEdit(user, clientId);
  revalidatePath("/portal", "layout");
}
