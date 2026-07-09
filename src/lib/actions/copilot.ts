"use server";

import { z } from "zod";
import { resolvePortalClient } from "@/lib/auth-guard";
import { runCopilot, type CopilotMessage } from "@/lib/agents/copilot";

const historySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4000),
    }),
  )
  .max(24);

export interface CopilotState {
  reply: string | null;
  error?: string;
}

/**
 * Best-effort per-client throttle (module scope — per serverless instance, so
 * a cost brake rather than a hard guarantee). Each exchange runs up to
 * MAX_TURNS model calls, so unthrottled spam gets expensive fast.
 */
const lastCallAt = new Map<string, number>();
const dailyCount = new Map<string, { day: string; n: number }>();
const MIN_GAP_MS = 3000;
const MAX_PER_DAY = 60;

function throttled(clientId: string): string | null {
  const now = Date.now();
  const last = lastCallAt.get(clientId) ?? 0;
  if (now - last < MIN_GAP_MS) return "One question at a time — give me a second.";
  const day = new Date().toISOString().slice(0, 10);
  const entry = dailyCount.get(clientId);
  const n = entry?.day === day ? entry.n : 0;
  if (n >= MAX_PER_DAY) return "You've hit today's assistant limit — try again tomorrow.";
  lastCallAt.set(clientId, now);
  dailyCount.set(clientId, { day, n: n + 1 });
  return null;
}

/** One copilot exchange. Tenancy: the clientId comes from the session, never the form. */
export async function copilotAction(
  _prev: CopilotState,
  formData: FormData,
): Promise<CopilotState> {
  const { clientId } = await resolvePortalClient();

  const question = String(formData.get("question") ?? "").trim().slice(0, 1000);
  if (!question) return { reply: null, error: "Ask something first." };

  const limit = throttled(clientId);
  if (limit) return { reply: null, error: limit };

  let history: CopilotMessage[] = [];
  try {
    history = historySchema.parse(JSON.parse(String(formData.get("history") ?? "[]")));
  } catch {
    history = [];
  }

  const reply = await runCopilot(clientId, [...history, { role: "user", content: question }]);
  return { reply };
}
