"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { saveGuidelinesAction } from "@/lib/actions/guidelines";
import { initialActionState } from "@/lib/actions/types";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Client } from "@/db/schema";

type GuidelineField = "greeting" | "agentGuidance" | "bookingInstructions";

/** One card = one field = its own Save button (saves independently of the others). */
function GuidelineCard(props: {
  clientId: string;
  field: GuidelineField;
  title: string;
  description: string;
  label: string;
  rows: number;
  defaultValue: string;
  placeholder: string;
}) {
  const [state, action, pending] = useActionState(saveGuidelinesAction, initialActionState);
  useEffect(() => {
    if (state.ok) toast.success("Saved — your AI was updated.");
    else if (state.error) toast.error(state.error);
  }, [state]);

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
            <Textarea
              name={props.field}
              rows={props.rows}
              defaultValue={props.defaultValue}
              placeholder={props.placeholder}
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={pending}>Save</SubmitButton>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

export function GuidelinesForm({ client }: { client: Client }) {
  return (
    <div className="space-y-6">
      <GuidelineCard
        clientId={client.id}
        field="greeting"
        title="Greeting"
        description="The first thing callers hear when your AI answers."
        label="Opening line"
        rows={2}
        defaultValue={client.greeting ?? ""}
        placeholder="Hi, thanks for calling! How can I help you today?"
      />
      <GuidelineCard
        clientId={client.id}
        field="agentGuidance"
        title="What your receptionist can say"
        description="Tell it what to emphasize and what to avoid — these take priority over everything else."
        label="Talking points & limits"
        rows={6}
        defaultValue={client.agentGuidance ?? ""}
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
        defaultValue={client.bookingInstructions ?? ""}
        placeholder={
          "e.g.\n• Only book cleanings and new-patient exams. For anything else, take a message.\n• Always confirm the date, time, and spelling of their name.\n• Mention a $50 deposit for cosmetic consults."
        }
      />
    </div>
  );
}
