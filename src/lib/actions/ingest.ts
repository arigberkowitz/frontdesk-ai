"use server";

import { revalidatePath } from "next/cache";
import { requireClientEditor } from "@/lib/auth-guard";
import { assertClientInOrg, getClientByIdUnsafe } from "@/lib/data/clients";
import { ingestDocument } from "@/lib/agents/ingest";
import { type ActionState } from "./types";

const MAX_DOC_BYTES = 8 * 1024 * 1024; // matches next.config serverActions bodySizeLimit
const MAX_DOC_CHARS = 100_000;

/**
 * Dropped/browsed file → plain text for the "Teach it from a document" box.
 * PDF via pdf-parse, .docx via mammoth, plain-text formats decoded directly.
 * Extraction only — nothing is learned until the owner clicks "Draft Q&As".
 */
export async function extractDocumentTextAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const guard = await requireClientEditor(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  await assertClientInOrg(guard.user.orgId, clientId);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Drop a file first." };
  }
  if (file.size > MAX_DOC_BYTES) {
    return { ok: false, error: "That file is over 8 MB — export a smaller version or paste the text." };
  }

  const name = file.name || "document";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const buf = Buffer.from(await file.arrayBuffer());

  let text = "";
  try {
    if (ext === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const extracted = await extractText(pdf, { mergePages: true });
      text = String(extracted.text);
    } else if (ext === "docx") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (["txt", "md", "csv", "text"].includes(ext)) {
      text = buf.toString("utf8");
    } else if (ext === "doc") {
      return {
        ok: false,
        error: "Old-style .doc files aren't supported — save it as .docx or PDF and try again.",
      };
    } else {
      return { ok: false, error: "That file type isn't supported — use PDF, Word (.docx), or plain text." };
    }
  } catch {
    return { ok: false, error: `Couldn't read “${name}” — the file may be corrupted or protected.` };
  }

  const cleaned = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length < 40) {
    return {
      ok: false,
      error: `“${name}” has no readable text — scanned/image PDFs need OCR. Paste the text instead.`,
    };
  }

  return { ok: true, data: { text: cleaned.slice(0, MAX_DOC_CHARS), name } };
}

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
