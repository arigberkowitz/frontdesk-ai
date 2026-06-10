"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { savePortalProfileAction, contactSupportAction } from "@/lib/actions/portal";
import { initialActionState } from "@/lib/actions/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import { TIMEZONES } from "@/config/options";
import type { Client } from "@/db/schema";

export function PortalSettings({ client }: { client: Client }) {
  const [profile, profileAction, profilePending] = useActionState(
    savePortalProfileAction,
    initialActionState,
  );
  const [alerts, alertsAction, alertsPending] = useActionState(
    savePortalProfileAction,
    initialActionState,
  );
  const [help, helpAction, helpPending] = useActionState(contactSupportAction, initialActionState);
  const helpFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (profile.ok) toast.success("Saved.");
    else if (profile.error) toast.error(profile.error);
  }, [profile]);
  useEffect(() => {
    if (alerts.ok) toast.success("Alert settings saved.");
    else if (alerts.error) toast.error(alerts.error);
  }, [alerts]);
  useEffect(() => {
    if (help.ok) {
      toast.success("Message sent — we'll get back to you by email.");
      helpFormRef.current?.reset();
    } else if (help.error) {
      toast.error(help.error);
    }
  }, [help]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>Your name and timezone — used across your AI and bookings.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={profileAction} className="space-y-4">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Business name" error={profile.fieldErrors?.name}>
              <Input name="name" defaultValue={client.name} required />
            </Field>
            <Field label="Timezone" hint="Used when your AI offers appointment times.">
              <NativeSelect name="timezone" defaultValue={client.timezone}>
                {TIMEZONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="flex justify-end">
              <SubmitButton pending={profilePending}>Save</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <CardDescription>
            Where we notify you the moment your AI books an appointment or takes a message.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={alertsAction} className="space-y-4">
            <input type="hidden" name="clientId" value={client.id} />
            <Field
              label="Email for alerts"
              hint="New bookings and messages are emailed here."
              error={alerts.fieldErrors?.ownerEmail}
            >
              <Input
                name="ownerEmail"
                type="email"
                defaultValue={client.ownerEmail ?? ""}
                placeholder="you@yourbusiness.com"
              />
            </Field>
            <Field
              label="Text alerts to (phone)"
              hint="We'll text this number on new bookings and messages. Also used for live call transfers."
              error={alerts.fieldErrors?.alertPhone}
            >
              <Input
                name="alertPhone"
                defaultValue={client.escalationNumber ?? ""}
                placeholder="+1 415 555 0100"
              />
            </Field>
            <div className="flex justify-end">
              <SubmitButton pending={alertsPending}>Save</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Get help</CardTitle>
          <CardDescription>
            Having trouble or have a question? Send us a note and we&apos;ll reply by email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={helpFormRef} action={helpAction} className="space-y-4">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Subject" hint="Optional">
              <Input name="subject" placeholder="e.g. My AI isn't answering" />
            </Field>
            <Field label="Message" error={help.fieldErrors?.message}>
              <Textarea
                name="message"
                rows={5}
                placeholder="Tell us what's going on and we'll help you out."
              />
            </Field>
            <div className="flex justify-end">
              <SubmitButton pending={helpPending}>Send message</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
