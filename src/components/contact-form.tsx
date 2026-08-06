"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Send } from "lucide-react";
import { sendContactMessageAction } from "@/lib/actions/contact";
import { initialActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";

const SUBJECTS = [
  "I'd like a free trial",
  "A question before I sign up",
  "Something isn't working",
  "Something else",
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      <Send className="size-4" />
      {pending ? "Sending…" : "Send message"}
    </Button>
  );
}

/**
 * Ask a question without making an account first.
 *
 * The link that leads here says "ask us for a trial", and until now it landed on
 * a sign-in wall — which asked a stranger to create an account before they were
 * allowed to ask whether they wanted one. A mailto: isn't much better: it opens
 * whatever mail client the machine happens to have configured, which on a shared
 * or work computer is often nothing at all.
 */
export function ContactForm({ ownerEmail }: { ownerEmail: string }) {
  const [state, action] = useActionState(sendContactMessageAction, initialActionState);

  if (state.ok) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          Message sent
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          It goes straight to my inbox and I read every one — usually same day. If it&apos;s urgent,
          write to {ownerEmail} directly.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border bg-card p-5">
      {/* Bots fill everything they can see. This one nobody can. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] size-0"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <Input name="name" placeholder="Ari Berkowitz" autoComplete="name" />
        </Field>
        <Field label="Email" error={state.fieldErrors?.email}>
          <Input
            name="email"
            type="email"
            placeholder="you@yourbusiness.com"
            autoComplete="email"
            required
          />
        </Field>
      </div>

      <Field label="What's this about?">
        <NativeSelect name="subject" defaultValue={SUBJECTS[0]} className="h-9">
          {SUBJECTS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Message" error={state.fieldErrors?.message}>
        <Textarea
          name="message"
          rows={5}
          required
          placeholder="Tell me about your business — what kind of calls you get, and how many you're missing."
        />
      </Field>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton />
        <span className="text-xs text-muted-foreground">
          Goes straight to a person. No newsletter, no autoresponder.
        </span>
      </div>
    </form>
  );
}
