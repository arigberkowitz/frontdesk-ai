"use client";

import { useActionState, useEffect, useState } from "react";
import { HelpCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createKnowledgeAction,
  deleteKnowledgeAction,
  updateKnowledgeAction,
} from "@/lib/actions/knowledge";
import { initialActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import { EmptyState } from "@/components/empty-state";
import type { KnowledgeItem } from "@/db/schema";

function KnowledgeForm({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(createKnowledgeAction, initialActionState);
  useEffect(() => {
    if (state.ok) {
      toast.success("FAQ added");
      onDone();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="Question" error={state.fieldErrors?.question}>
        <Input name="question" required placeholder="Do you take walk-ins?" />
      </Field>
      <Field label="Answer" error={state.fieldErrors?.answer}>
        <Textarea name="answer" rows={4} required placeholder="Yes — walk-ins are welcome before 4pm." />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pending={pending}>Add FAQ</SubmitButton>
      </div>
    </form>
  );
}

function AddKnowledgeDialog({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" />
            Add FAQ
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add FAQ</DialogTitle>
        </DialogHeader>
        {open ? <KnowledgeForm clientId={clientId} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function KnowledgeEditForm({ item, onDone }: { item: KnowledgeItem; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateKnowledgeAction, initialActionState);
  useEffect(() => {
    if (state.ok) {
      toast.success("FAQ updated");
      onDone();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={item.clientId} />
      <input type="hidden" name="itemId" value={item.id} />
      <Field label="Question" error={state.fieldErrors?.question}>
        <Input name="question" required defaultValue={item.question} />
      </Field>
      <Field label="Answer" error={state.fieldErrors?.answer}>
        <Textarea name="answer" rows={4} required defaultValue={item.answer} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pending={pending}>Save changes</SubmitButton>
      </div>
    </form>
  );
}

function EditKnowledgeDialog({ item }: { item: KnowledgeItem }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Edit FAQ">
            <Pencil className="size-4" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit FAQ</DialogTitle>
        </DialogHeader>
        {open ? <KnowledgeEditForm item={item} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

export function KnowledgeTab({
  clientId,
  knowledge,
}: {
  clientId: string;
  knowledge: KnowledgeItem[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <AddKnowledgeDialog clientId={clientId} />
      </div>
      {knowledge.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title="No FAQ yet"
          description="Teach the AI answers to common questions — it answers only from what you add here."
        />
      ) : (
        <ul className="space-y-3">
          {knowledge.map((k) => (
            <li key={k.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{k.question}</p>
                  <p className="text-sm text-muted-foreground">{k.answer}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <EditKnowledgeDialog item={k} />
                  <form action={deleteKnowledgeAction}>
                    <input type="hidden" name="clientId" value={clientId} />
                    <input type="hidden" name="itemId" value={k.id} />
                    <Button variant="ghost" size="icon" type="submit" aria-label="Delete FAQ">
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
