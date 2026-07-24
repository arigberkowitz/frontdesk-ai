"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, Phone } from "lucide-react";
import { submitIntakeAction } from "@/lib/actions/intake";
import { initialActionState } from "@/lib/actions/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/form/field";
import { Button } from "@/components/ui/button";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Setting things up…" : "Send my details"}
    </Button>
  );
}

export function IntakeForm({
  token,
  defaultName,
  defaultWebsite,
}: {
  token: string;
  defaultName: string;
  defaultWebsite: string;
}) {
  const [state, action] = useActionState(submitIntakeAction, initialActionState);

  if (state.ok) {
    return (
      <div className="mx-auto max-w-md space-y-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-6" />
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">You&apos;re all set!</h1>
        <p className="text-muted-foreground">
          Thanks — we&apos;ve got your details{defaultWebsite ? " and are reading your website" : ""}. We&apos;ll
          build your AI receptionist and follow up to get it live. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="w-full max-w-lg space-y-5">
      <div className="space-y-2 text-center">
        <div
          className="mx-auto flex size-11 items-center justify-center rounded-2xl text-white"
          style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
        >
          <Phone className="size-5" />
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Let&apos;s set up your AI receptionist
        </h1>
        <p className="text-sm text-muted-foreground">
          A couple of quick details and we&apos;ll build it for you. Takes about a minute.
        </p>
      </div>

      <input type="hidden" name="token" value={token} />

      <Field label="Business name" error={state.fieldErrors?.name}>
        <Input name="name" defaultValue={defaultName} placeholder="Bright Smile Dental" required />
      </Field>
      <Field label="Website" hint="Optional — we'll draft your services, hours, and FAQs from it.">
        <Input name="websiteUrl" type="url" defaultValue={defaultWebsite} placeholder="https://yourbusiness.com" />
      </Field>
      <Field label="Best email for alerts" error={state.fieldErrors?.ownerEmail}>
        <Input name="ownerEmail" type="email" placeholder="you@yourbusiness.com" />
      </Field>
      <Field label="Best cell for alerts & call transfers">
        <Input name="ownerCell" placeholder="+1 415 555 0100" />
      </Field>
      <Field label="Anything we should know?" hint="What should the AI always mention, or never say?">
        <Textarea
          name="instructions"
          rows={4}
          placeholder={"e.g. We're accepting new patients.\nNever quote exact prices — say it depends on insurance."}
        />
      </Field>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
