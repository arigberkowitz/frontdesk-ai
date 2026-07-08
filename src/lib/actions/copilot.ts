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

/** One copilot exchange. Tenancy: the clientId comes from the session, never the form. */
export async function copilotAction(
  _prev: CopilotState,
  formData: FormData,
): Promise<CopilotState> {
  const { clientId } = await resolvePortalClient();

  const question = String(formData.get("question") ?? "").trim();
  if (!question) return { reply: null, error: "Ask something first." };

  let history: CopilotMessage[] = [];
  try {
    history = historySchema.parse(JSON.parse(String(formData.get("history") ?? "[]")));
  } catch {
    history = [];
  }

  const reply = await runCopilot(clientId, [...history, { role: "user", content: question }]);
  return { reply };
}
