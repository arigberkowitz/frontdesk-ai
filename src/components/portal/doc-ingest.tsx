"use client";

import { useActionState, useEffect, useRef } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader } from "@/components/panel-header";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import { ingestDocumentAction } from "@/lib/actions/ingest";
import { initialActionState } from "@/lib/actions/types";

/**
 * Policy-doc ingestion: paste a price sheet / policy / FAQ document, the AI
 * drafts Q&As from it, and every one waits in the "Your AI learned" queue for
 * approval. The receptionist never learns anything the owner didn't sign off.
 */
export function DocIngest({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(ingestDocumentAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Done.");
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={FileText}
          title="Teach it from a document"
          description="Paste your price sheet, policies, or FAQ. It drafts Q&As using only what's written — you approve each one before your AI can say it."
        />
        <form ref={formRef} action={action} className="mt-4 space-y-3">
          <input type="hidden" name="clientId" value={clientId} />
          <Field label="Document text" error={state.fieldErrors?.docText}>
            <Textarea
              name="docText"
              rows={6}
              placeholder={"Paste from your PDF, Word doc, or website — e.g.\n\nHaircut $35 (30 min). Color from $120.\nCancellations within 24 hours are charged 50%…"}
              disabled={pending}
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={pending}>
              {pending ? "Reading the document…" : "Draft Q&As from this"}
            </SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
