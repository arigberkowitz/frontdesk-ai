"use client";

import { useActionState, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { onboardFromWebsiteAction } from "@/lib/actions/onboard";
import { initialActionState } from "@/lib/actions/types";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";

export function OnboardWebsiteForm() {
  const [state, action, pending] = useActionState(onboardFromWebsiteAction, initialActionState);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-5">
      <Field label="Business name" htmlFor="ai-name" error={state.fieldErrors?.name}>
        <Input
          id="ai-name"
          name="name"
          required
          placeholder="Bright Smile Dental"
          autoFocus
          disabled={pending}
        />
      </Field>

      <Field
        label="Website URL"
        htmlFor="ai-url"
        error={state.fieldErrors?.websiteUrl}
        hint="We'll read the site and draft services, hours, and FAQ for you to review."
      >
        <Input
          id="ai-url"
          name="websiteUrl"
          required
          placeholder="https://example.com"
          disabled={pending}
        />
      </Field>

      <SubmitButton pending={pending} className="w-full">
        <Sparkles className="size-4" />
        {pending ? "Reading the website…" : "Scrape & draft with AI"}
      </SubmitButton>

      {pending ? (
        <p className="text-center text-xs text-muted-foreground">
          This can take 10–20 seconds while we read the site and structure it.
        </p>
      ) : null}
    </form>
  );
}
