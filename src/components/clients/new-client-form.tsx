"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClientAction } from "@/lib/actions/clients";
import { initialActionState } from "@/lib/actions/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import { INDUSTRIES, TIMEZONES } from "@/config/options";

export function NewClientForm() {
  const [state, action, pending] = useActionState(createClientAction, initialActionState);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-5">
      <Field label="Business name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" required placeholder="Bright Smile Dental" autoFocus />
      </Field>

      <Field
        label="Website"
        htmlFor="websiteUrl"
        error={state.fieldErrors?.websiteUrl}
        hint="We'll use this to auto-draft your agent from the website."
      >
        <Input id="websiteUrl" name="websiteUrl" type="url" placeholder="https://example.com" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Industry" htmlFor="industry">
          <NativeSelect id="industry" name="industry" defaultValue="">
            <option value="">Select…</option>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Timezone" htmlFor="timezone">
          <NativeSelect id="timezone" name="timezone" defaultValue="America/Los_Angeles">
            {TIMEZONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field label="Address" htmlFor="address" error={state.fieldErrors?.address}>
        <Textarea id="address" name="address" rows={2} placeholder="123 Main St, San Francisco, CA" />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" render={<Link href="/clients" />} nativeButton={false}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>Create client</SubmitButton>
      </div>
    </form>
  );
}
