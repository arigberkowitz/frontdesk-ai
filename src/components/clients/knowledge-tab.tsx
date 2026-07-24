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
import { Card, CardContent } from "@/components/ui/card";
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

/** Starter questions, grouped, so owners aren't staring at a blank box. Clicking one
 *  opens the add form with the question pre-filled — they just write the answer. */
const EXAMPLE_GROUPS: { label: string; questions: string[] }[] = [
  {
    label: "Hours & availability",
    questions: ["What are your hours?", "Are you open on weekends?", "Are you open on holidays?"],
  },
  {
    label: "Location & parking",
    questions: ["Where are you located?", "Is there parking?", "Are you wheelchair accessible?"],
  },
  {
    label: "Pricing & payment",
    questions: [
      "How much does a typical visit cost?",
      "Do you offer free estimates or consultations?",
      "What payment methods do you accept?",
    ],
  },
  {
    label: "Services",
    questions: ["What services do you offer?", "Do you take walk-ins?", "Do you offer emergency service?"],
  },
  {
    label: "Booking & cancellations",
    questions: [
      "How do I book an appointment?",
      "What's your cancellation policy?",
      "How far ahead should I book?",
    ],
  },
  {
    label: "New customers",
    questions: ["Are you accepting new customers?", "What should I bring to my first visit?"],
  },
];

function KnowledgeForm({
  clientId,
  defaultQuestion,
  onDone,
}: {
  clientId: string;
  defaultQuestion?: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(createKnowledgeAction, initialActionState);
  useEffect(() => {
    if (state.ok) {
      toast.success("Added to your knowledge base");
      onDone();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      <Field label="Question a caller might ask" error={state.fieldErrors?.question}>
        <Input name="question" required defaultValue={defaultQuestion} placeholder="Do you take walk-ins?" />
      </Field>
      <Field
        label="What your AI should say"
        error={state.fieldErrors?.answer}
        hint="Answer the way you'd want a great receptionist to — clear and specific."
      >
        <Textarea name="answer" rows={4} required placeholder="Yes — walk-ins are welcome before 4pm." />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pending={pending}>Add answer</SubmitButton>
      </div>
    </form>
  );
}

function KnowledgeEditForm({ item, onDone }: { item: KnowledgeItem; onDone: () => void }) {
  const [state, action, pending] = useActionState(updateKnowledgeAction, initialActionState);
  useEffect(() => {
    if (state.ok) {
      toast.success("Saved");
      onDone();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="clientId" value={item.clientId} />
      <input type="hidden" name="itemId" value={item.id} />
      <Field label="Question a caller might ask" error={state.fieldErrors?.question}>
        <Input name="question" required defaultValue={item.question} />
      </Field>
      <Field label="What your AI should say" error={state.fieldErrors?.answer}>
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
          <Button variant="ghost" size="icon" aria-label="Edit answer">
            <Pencil className="size-4" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit answer</DialogTitle>
        </DialogHeader>
        {open ? <KnowledgeEditForm item={item} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** How-it-works steps + clickable starter questions. Shown above the list so the
 *  page teaches owners how to build out a deep knowledge base. */
function KnowledgeGuide({ onPick }: { onPick: (question: string) => void }) {
  return (
    <Card className="bg-muted/30">
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="text-sm font-medium">How your knowledge base works</p>
          <ol className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">1.</span> Each entry is a question a
              caller might ask, plus the answer you want your AI to give.
            </li>
            <li>
              <span className="font-medium text-foreground">2.</span> Your AI only says what&apos;s
              here — anything it doesn&apos;t know, it offers to take a message instead of guessing.
            </li>
            <li>
              <span className="font-medium text-foreground">3.</span> Add as many as you can, including
              different ways people ask the same thing. More entries = fewer missed answers.
            </li>
          </ol>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Tap a starter question to add it — you just fill in the answer:
          </p>
          <div className="mt-2 space-y-2.5">
            {EXAMPLE_GROUPS.map((g) => (
              <div key={g.label} className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs font-medium text-muted-foreground">{g.label}:</span>
                {g.questions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onPick(q)}
                    className="rounded-full border bg-background px-2.5 py-1 text-xs outline-none transition-colors hover:border-primary/50 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    + {q}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function KnowledgeTab({
  clientId,
  knowledge,
}: {
  clientId: string;
  knowledge: KnowledgeItem[];
}) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>(undefined);

  function openWith(question?: string) {
    setPrefill(question);
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <KnowledgeGuide onPick={(q) => openWith(q)} />

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {knowledge.length} {knowledge.length === 1 ? "answer" : "answers"} in your knowledge base
        </p>
        <Button onClick={() => openWith(undefined)}>
          <Plus className="size-4" />
          Add answer
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an answer</DialogTitle>
          </DialogHeader>
          {open ? (
            <KnowledgeForm
              key={prefill ?? "blank"}
              clientId={clientId}
              defaultQuestion={prefill}
              onDone={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {knowledge.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title="Nothing in your knowledge base yet"
          description="Tap a starter question above, or add your own. Your AI answers only from what you add here."
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
                    <Button variant="ghost" size="icon" type="submit" aria-label="Delete answer">
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
