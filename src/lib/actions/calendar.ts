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
  if (!apiKey || apiKey.length > 300) {
    return { ok: false, fieldErrors: { apiKey: ["Paste your Cal.com API key"] } };
  }

  // Verify the key against Cal.com RIGHT NOW and auto-pick the default event
  // type — a saved-but-broken key would only surface days later, mid-call.
  let eventTypeId: number | null = null;
  try {
    const res = await fetch(
      `https://api.cal.com/v1/event-types?apiKey=${encodeURIComponent(apiKey)}`,
      { cache: "no-store" },
    );
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        fieldErrors: { apiKey: ["That key didn't work — copy it again from Cal.com → Settings → Developer → API keys."] },
      };
    }
    if (!res.ok) throw new Error(`Cal.com responded ${res.status}`);
    const data = (await res.json()) as {
      event_types?: Array<{ id: number; hidden?: boolean; length?: number }>;
    };
    const visible = (data.event_types ?? []).filter((e) => !e.hidden);
    eventTypeId = (visible[0] ?? data.event_types?.[0])?.id ?? null;
    if (!eventTypeId) {
      return {
        ok: false,
        error:
          "Your key works, but that Cal.com account has no event types yet. Create one in Cal.com (Event Types → New), then connect again.",
      };
    }
  } catch {
    return { ok: false, error: "Couldn't reach Cal.com to verify the key — try again in a moment." };
  }

  await updateClient(user.orgId, clientId, {
    calendarProvider: "calcom",
    calendarSecret: encryptSecret(apiKey),
    calendarId: String(eventTypeId),
    calendarAccount: "Cal.com",
    calendarConnectedAt: new Date(),
  });
  // Booking just became possible — republish so the agent starts offering it.
  await applyClientEdit(user, clientId);
  revalidatePath("/portal", "layout");
  return {
    ok: true,
    message: "Cal.com verified and connected — your AI can now book appointments.",
  };
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
