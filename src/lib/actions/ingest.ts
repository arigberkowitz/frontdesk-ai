"use server";

import { revalidatePath } from "next/cache";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe } from "@/lib/data/clients";
import { ingestDocument } from "@/lib/agents/ingest";
import { type ActionState } from "./types";

/** Paste a business document → drafted Q&As in the approval queue. */
export async function ingestDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  const user = guard.user;
  await assertClientInOrg(user.orgId, clientId);

  const docText = String(formData.get("docText") ?? "").trim();
  if (docText.length < 40) {
    return { ok: false, fieldErrors: { docText: ["Paste the document text — a few sentences at least."] } };
  }

  const client = await getClientByIdUnsafe(clientId);
  if (!client) return { ok: false, error: "Business not found." };

  try {
    const result = await ingestDocument(client, docText);
    revalidatePath("/portal", "layout");
    if (result.drafted === 0) {
      return {
        ok: true,
        message:
          result.skippedDuplicates > 0
            ? "Everything in that document is already in your knowledge."
            : "Couldn't find caller-facing facts in that text — try a price sheet, policy, or FAQ.",
      };
    }
    return {
      ok: true,
      message: `Drafted ${result.drafted} Q&A${result.drafted === 1 ? "" : "s"} — review and approve them under "Your AI learned" on your Overview.`,
    };
  } catch {
    return { ok: false, error: "Couldn't read the document — please try again." };
  }
}
