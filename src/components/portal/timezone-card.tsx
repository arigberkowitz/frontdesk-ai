"use client";

import { useActionState, useEffect } from "react";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "@/components/panel-header";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import { savePortalProfileAction } from "@/lib/actions/portal";
import { initialActionState } from "@/lib/actions/types";
import { TIMEZONES } from "@/config/options";

/**
 * Timezone lives next to hours (they only mean something together). The same
 * setting also stays editable under Settings — this patches the same field.
 */
export function TimezoneCard({ clientId, timezone }: { clientId: string; timezone: string }) {
  const [state, action, pending] = useActionState(savePortalProfileAction, initialActionState);

  useEffect(() => {
    if (state.ok) toast.success("Timezone saved — your hours and appointment times use it now.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={Globe}
          title="Your timezone"
          description="The hours above and every appointment time your AI offers are in this timezone. You can also change it later under Settings."
        />
        <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="min-w-64 flex-1">
            <Field label="Timezone">
              <NativeSelect name="timezone" defaultValue={timezone}>
                {TIMEZONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <SubmitButton pending={pending}>Save</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
