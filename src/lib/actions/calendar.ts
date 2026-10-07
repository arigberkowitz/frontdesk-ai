"use server";

import { revalidatePath } from "next/cache";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg, updateClient } from "@/lib/data/clients";
import { applyClientEdit } from "@/lib/agent-publish";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { revokeGoogleToken } from "@/lib/google-calendar";
import { logger } from "@/lib/logger";
import {
  MAX_BUSY_CALENDARS,
  checkGoogleCalendarIds,
  filterMicrosoftIds,
  loadOwnerCalendars,
  normalizeBusyIds,
} from "@/lib/busy-calendars";
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
    calendarBusyIds: null,
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
  const client = await assertClientInOrg(user.orgId, clientId);
  // Google: also revoke the grant, so "disconnect" means we can no longer read
  // the calendar at all — not just that we forgot the token. (Microsoft has no
  // per-token revoke endpoint for delegated grants; the owner removes the app
  // at myapps.microsoft.com / account.live.com if they want the grant gone.)
  if (client.calendarProvider === "google" && client.calendarSecret) {
    const token = readSecret(client.calendarSecret);
    if (token) {
      const revoked = await revokeGoogleToken(token);
      if (!revoked) logger.warn("calendar.google.revoke_failed", { clientId });
    }
  }
  await updateClient(user.orgId, clientId, {
    calendarProvider: null,
    calendarSecret: null,
    calendarId: null,
    calendarAccount: null,
    calendarConnectedAt: null,
    calendarBusyIds: null,
  });
  await applyClientEdit(user, clientId);
  revalidatePath("/portal", "layout");
}

function readSecret(payload: string): string | null {
  try {
    return decryptSecret(payload);
  } catch {
    return null; // unreadable (rotated key): nothing to revoke with
  }
}

/**
 * Save which extra calendars count as busy. Google: typed calendar IDs, each
 * checked with freeBusy (listing Google calendars would need a new OAuth
 * scope). Microsoft: ticked calendars, each verified against the mailbox's
 * own list. Changing this doesn't touch the agent's prompt, so no republish.
 */
export async function saveBusyCalendarsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const client = await assertClientInOrg(guard.user.orgId, clientId);

  const raw = formData.getAll("calendarId");
  const added = String(formData.get("addCalendarId") ?? "").trim();
  if (added) raw.push(added);
  if (normalizeBusyIds(raw, client.calendarId, Infinity).length > MAX_BUSY_CALENDARS) {
    return { ok: false, error: `You can add up to ${MAX_BUSY_CALENDARS} extra calendars.` };
  }
  let ids = normalizeBusyIds(raw, client.calendarId);

  if (client.calendarProvider === "google") {
    const checked = await checkGoogleCalendarIds(client, ids);
    if (!checked.ok) {
      if ("error" in checked) return { ok: false, error: checked.error };
      const names = checked.bad.map((b) => `"${b.id}"`).join(", ");
      return {
        ok: false,
        fieldErrors: {
          addCalendarId: [
            `Google can't see ${names}. Check the Calendar ID, or share that calendar with ${client.calendarAccount ?? "your connected account"} (at least "See only free/busy").`,
          ],
        },
      };
    }
  } else if (client.calendarProvider === "microsoft") {
    const list = await loadOwnerCalendars(client);
    if (list.kind !== "microsoft") {
      return { ok: false, error: list.kind === "error" ? list.message : "Couldn't load your calendars." };
    }
    ids = filterMicrosoftIds(ids, list.calendars);
  } else {
    return { ok: false, error: "Connect Google Calendar or Outlook first." };
  }

  await updateClient(guard.user.orgId, clientId, { calendarBusyIds: ids.length ? ids : null });
  revalidatePath("/portal/settings/calendar");
  return {
    ok: true,
    message: ids.length
      ? `Saved. Your AI now treats ${ids.length === 1 ? "1 more calendar" : `${ids.length} more calendars`} as busy.`
      : "Saved. Only your main calendar counts as busy.",
  };
}
