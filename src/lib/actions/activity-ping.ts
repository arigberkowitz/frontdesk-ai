"use server";

import { resolvePortalClient } from "@/lib/auth-guard";
import { listCalls } from "@/lib/data/calls";
import { CALL_OUTCOME_LABELS } from "@/config/options";

export interface ActivityPing {
  now: string;
  events: { title: string; body: string }[];
}

/** Poll target for live desktop alerts: calls that started after `sinceIso`. */
export async function activityPingAction(sinceIso: string): Promise<ActivityPing> {
  const { clientId } = await resolvePortalClient();
  const since = new Date(sinceIso).getTime() || Date.now();
  const calls = await listCalls(clientId, 10);
  const events = calls
    .filter((c) => c.startAt && c.startAt.getTime() > since)
    .slice(0, 5)
    .map((c) => ({
      title:
        c.outcome === "booked"
          ? "📅 New appointment booked"
          : c.outcome === "lead"
            ? "📨 New message captured"
            : "📞 Call answered",
      body: c.summary?.slice(0, 120) ?? (c.outcome ? CALL_OUTCOME_LABELS[c.outcome] : "Your AI picked up."),
    }));
  return { now: new Date().toISOString(), events };
}
