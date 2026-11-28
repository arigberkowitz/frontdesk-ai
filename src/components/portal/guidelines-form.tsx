"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { saveGuidelinesAction } from "@/lib/actions/guidelines";
import { draftSetupTextAction } from "@/lib/actions/setup-draft";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { AutofillTextarea } from "@/components/form/autofill-textarea";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SafeClient as Client } from "@/lib/client-safe";

type GuidelineField = "greeting" | "agentGuidance" | "bookingInstructions";

/** One card = one field = its own Save button (saves independently of the others). */
function GuidelineCard(props: {
  clientId: string;
  field: GuidelineField;
  title: string;
  description: string;
  label: string;
  rows: number;
  value: string;
  onValueChange: (v: string) => void;
  placeholder: string;
}) {
  // What was last saved, so we can say "Not saved yet" after a fill or an edit.
  const [saved, setSaved] = useState(props.value);
  const [state, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await saveGuidelinesAction(prev, formData);
      if (result.ok) setSaved(String(formData.get(props.field) ?? ""));
      return result;
    },
    initialActionState,
  );
  useEffect(() => {
    if (state.ok) toast.success(state.message ?? "Saved — your AI was updated.");
    else if (state.error) toast.error(state.error);
  }, [state]);
  const unsaved = props.value !== saved;

  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={props.clientId} />
      <Card>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={props.label}>
            <AutofillTextarea
              name={props.field}
              rows={props.rows}
              clientId={props.clientId}
              field={props.field}
              value={props.value}
              onValueChange={props.onValueChange}
              placeholder={props.placeholder}
            />
          </Field>
          <div className="flex items-center justify-end gap-3">
            {unsaved ? (
              <span className="text-xs text-muted-foreground" role="status">
                Not saved yet
              </span>
            ) : null}
            <SubmitButton pending={pending}>Save</SubmitButton>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

const FILL_ALL_FIELDS: GuidelineField[] = ["greeting", "agentGuidance", "bookingInstructions"];

export function GuidelinesForm({ client }: { client: Client }) {
  const [values, setValues] = useState<Record<GuidelineField, string>>({
    greeting: client.greeting ?? "",
    agentGuidance: client.agentGuidance ?? "",
    bookingInstructions: client.bookingInstructions ?? "",
  });
  const set = (f: GuidelineField) => (v: string) => setValues((cur) => ({ ...cur, [f]: v }));
  const empty = FILL_ALL_FIELDS.filter((f) => !values[f].trim());
  const [filling, startFilling] = useTransition();
  const [summary, setSummary] = useState<string | null>(null);

  // Only ever writes into boxes that are empty, so there is nothing to confirm
  // and nothing of the owner's to lose. Nothing is saved from here.
  function fillEmpty() {
    const targets = empty;
    setSummary(null);
    startFilling(async () => {
      const results = await Promise.all(
        targets.map((field) =>
          draftSetupTextAction({ clientId: client.id, field }).catch(
            () => ({ ok: false as const, error: "" }),
          ),
        ),
      );
      const next: Partial<Record<GuidelineField, string>> = {};
      results.forEach((r, i) => {
        if (r.ok) next[targets[i]] = r.text;
      });
      const n = Object.keys(next).length;
      setValues((cur) => ({
        ...cur,
        // Don't clobber anything typed while the drafts were loading.
        ...Object.fromEntries(
          Object.entries(next).filter(([f]) => !cur[f as GuidelineField].trim()),
        ),
      }));
      setSummary(
        n === 0
          ? "We couldn't write suggestions just now. Try again in a moment."
          : `Filled in ${n} ${n === 1 ? "box" : "boxes"}. Read ${n === 1 ? "it" : "them"} over, edit anything, then press Save on each one.`,
      );
    });
  }

  return (
    <div className="space-y-6">
      {empty.length > 0 || summary ? (
        <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Start from a suggestion</p>
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {summary ??
                "We can write a first draft of the empty boxes below from your type of business, services and hours. Nothing is saved until you press Save."}
            </p>
          </div>
          {empty.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={fillEmpty}
              disabled={filling}
              className="max-sm:h-10 sm:shrink-0"
            >
              {filling ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {filling
                ? "Writing…"
                : empty.length === FILL_ALL_FIELDS.length
                  ? "Fill all boxes for me"
                  : "Fill the empty boxes for me"}
            </Button>
          ) : null}
        </div>
      ) : null}
      <GuidelineCard
        clientId={client.id}
        field="greeting"
        title="Greeting"
        description="The first thing callers hear when your AI answers. If it doesn't already say so, we add a short line telling callers they're talking to an AI assistant and the call may be recorded. That part is required and can't be turned off here."
        label="Opening line"
        rows={2}
        value={values.greeting}
        onValueChange={set("greeting")}
        placeholder="Hi, thanks for calling! How can I help you today?"
      />
      <GuidelineCard
        clientId={client.id}
        field="agentGuidance"
        title="What your receptionist can say"
        description="Tell it what to emphasize and what to avoid. It follows these closely — though it will always say it’s an AI, handle emergencies, and ask before texting anyone."
        label="Talking points & limits"
        rows={6}
        value={values.agentGuidance}
        onValueChange={set("agentGuidance")}
        placeholder={
          "e.g.\n• Always mention we're accepting new patients.\n• Never quote exact prices — say it depends on their insurance.\n• Don't give medical advice; offer to book a visit instead."
        }
      />
      <GuidelineCard
        clientId={client.id}
        field="bookingInstructions"
        title="How to handle booking"
        description="The rules your AI follows when booking an appointment."
        label="Booking rules"
        rows={6}
        value={values.bookingInstructions}
        onValueChange={set("bookingInstructions")}
        placeholder={
          "e.g.\n• Only book cleanings and new-patient exams. For anything else, take a message.\n• Always confirm the date, time, and spelling of their name.\n• Mention a $50 deposit for cosmetic consults."
        }
      />
    </div>
  );
}
