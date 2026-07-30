"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { FileText, FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader } from "@/components/panel-header";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import { extractDocumentTextAction, ingestDocumentAction } from "@/lib/actions/ingest";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { cn } from "@/lib/utils";

const ACCEPT = ".pdf,.docx,.txt,.md,.csv";

/**
 * Policy-doc ingestion: drop (or paste) a price sheet / policy / FAQ document,
 * the AI drafts Q&As from it, and every one waits in the "Your AI learned"
 * queue for approval. The receptionist never learns anything the owner didn't
 * sign off. Dropped files are extracted into the text box first, so the owner
 * always sees exactly what the AI will read.
 */
export function DocIngest({ clientId }: { clientId: string }) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Toast + state updates happen inside the transitions themselves — an effect
  // calling setState here would trip react-hooks/set-state-in-effect.
  const [state, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const next = await ingestDocumentAction(prev, formData);
      if (next.ok) {
        toast.success(next.message ?? "Done.");
        setText("");
      } else if (next.error) {
        toast.error(next.error);
      }
      return next;
    },
    initialActionState,
  );

  const [, extractDispatch, extracting] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const next = await extractDocumentTextAction(prev, formData);
      if (next.ok) {
        const d = next.data as { text: string; name: string };
        setText(d.text);
        toast.success(`Read “${d.name}” — check the text below, then draft.`);
      } else if (next.error) {
        toast.error(next.error);
      }
      return next;
    },
    initialActionState,
  );

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("file", file);
    startTransition(() => extractDispatch(fd));
  };

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={FileText}
          title="Teach it from a document"
          description="Drop your price sheet, policies, or FAQ — or paste the text. It drafts Q&As using only what's written; you approve each one before your AI can say it."
        />
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="clientId" value={clientId} />

          {/* Drop zone: extraction fills the textarea, so what the AI reads is
              always visible and editable before anything is drafted. */}
          <button
            type="button"
            disabled={extracting || pending}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed p-5 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              dragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50",
              (extracting || pending) && "cursor-wait opacity-70",
            )}
          >
            {extracting ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <FileUp className="size-5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">
              {extracting ? "Reading your file…" : "Drag & drop a file here, or click to browse"}
            </span>
            <span className="text-xs text-muted-foreground">
              PDF, Word (.docx), or plain text · up to 8 MB
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />

          <Field label="Document text" error={state.fieldErrors?.docText}>
            <Textarea
              name="docText"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Or paste from your PDF, Word doc, or website — e.g.\n\nHaircut $35 (30 min). Color from $120.\nCancellations within 24 hours are charged 50%…"}
              disabled={pending || extracting}
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={pending} disabled={extracting || text.trim().length === 0}>
              {pending ? "Reading the document…" : "Draft Q&As from this"}
            </SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
