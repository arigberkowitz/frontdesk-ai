"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { savePortalProfileAction, contactSupportAction } from "@/lib/actions/portal";
import { setEditCodeAction } from "@/lib/actions/edit-lock";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import { TIMEZONES } from "@/config/options";
import type { Client } from "@/db/schema";

/*
 * The portal settings forms, one component per card so each Settings section
 * can render just the ones it owns. Every form posts exactly the same fields
 * to the same action as before the split — only where they sit changed.
 */

function useSavedToast(state: ActionState, fallback: string) {
  useEffect(() => {
    if (state.ok) toast.success(state.message ?? fallback);
    else if (state.error) toast.error(state.error);
  }, [state, fallback]);
}

/** Name, timezone, languages. */
export function BusinessDetailsForm({ client }: { client: Client }) {
  const [profile, profileAction, profilePending] = useActionState(
    savePortalProfileAction,
    initialActionState,
  );
  useSavedToast(profile, "Saved.");
  return (
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
          <Field
            label="Languages your AI speaks"
            hint="Bilingual mode answers in English and switches to fluent Spanish the moment a caller speaks it — no extra staff, no extra cost."
          >
            <NativeSelect name="languages" defaultValue={client.languages}>
              <option value="en">English only</option>
              <option value="en-es">English + Spanish (bilingual)</option>
              <option value="es">Spanish first</option>
            </NativeSelect>
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={profilePending}>Save</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Alert email + phone, text alerts on/off, weekly summary email. */
export function AlertsForm({ client, isAdmin = true }: { client: Client; isAdmin?: boolean }) {
  const [alerts, alertsAction, alertsPending] = useActionState(
    savePortalProfileAction,
    initialActionState,
  );
  useSavedToast(alerts, "Alert settings saved.");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts</CardTitle>
        <CardDescription>
          Where we notify you the moment your AI books an appointment or takes a message.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isAdmin ? (
          <p className="mb-4 text-sm text-muted-foreground">
            Only the business owner can change where alerts go.
          </p>
        ) : null}
        <form action={alertsAction} className="space-y-4">
          <input type="hidden" name="clientId" value={client.id} />
          <fieldset disabled={!isAdmin} className="space-y-4">
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
          {/* The loop is the least obvious way to break this product, and the
              forwarded line is the number people reach for first. We can't
              detect it (we never store the number they forwarded), so say it
              plainly at the point of entry. */}
          <p className="-mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <strong>Use a mobile or a direct line — not the number you forwarded.</strong> Calls
            to your forwarded line go to your AI, so if it transfers a caller there, the call
            comes straight back to the AI and the caller never reaches a person.
          </p>
          <Field
            label="Text-message alerts"
            hint="Texts the number above the moment your AI books an appointment or takes a message. Email alerts always send."
          >
            <NativeSelect
              name="smsAlertsEnabled"
              defaultValue={client.smsAlertsEnabled ? "on" : "off"}
            >
              <option value="on">On — text me every booking and message</option>
              <option value="off">Off — email only</option>
            </NativeSelect>
          </Field>
          <div id="weekly-summary" className="scroll-mt-24">
            <Field
              label="Weekly summary email"
              hint="Every Monday: calls answered, bookings, cancellations, missed calls won back, new leads and customer texts from the past 7 days. Sent to the alerts email above."
            >
              <NativeSelect
                name="weeklySummaryEnabled"
                defaultValue={client.weeklySummaryEnabled ? "on" : "off"}
              >
                <option value="on">On — email me a summary every Monday</option>
                <option value="off">Off — no weekly summary</option>
              </NativeSelect>
            </Field>
            <a
              href="/portal/settings/weekly-summary"
              target="_blank"
              rel="noopener"
              className="mt-1 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Preview this week&apos;s summary
            </a>
          </div>
          <div className="flex justify-end">
            <SubmitButton pending={alertsPending}>Save</SubmitButton>
          </div>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}

/** Offer a real person + when one is reachable. */
export function HumanTouchForm({ client }: { client: Client }) {
  const [handoff, handoffAction, handoffPending] = useActionState(
    savePortalProfileAction,
    initialActionState,
  );
  useSavedToast(handoff, "Human-handoff settings saved.");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Human touch</CardTitle>
        <CardDescription>
          Many callers still want a real person. Your AI can offer to connect them — and if no
          one&apos;s free, it takes their name and number and promises a callback, so no one&apos;s
          left talking to a wall.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handoffAction} className="space-y-4">
          <input type="hidden" name="clientId" value={client.id} />
          <Field
            label="Offer to connect callers to a real person"
            hint="When on, your AI proactively offers a human for upset, sensitive, or complex calls — not only when asked. Transfers go to your alert phone above."
          >
            <NativeSelect
              name="humanHandoffEnabled"
              defaultValue={client.humanHandoffEnabled ? "on" : "off"}
            >
              <option value="on">On — offer a human when it helps</option>
              <option value="off">Off — only transfer if the caller asks</option>
            </NativeSelect>
          </Field>
          <Field
            label="When is a real person reachable?"
            hint="Optional. Your AI mentions this when offering a human, e.g. 'weekdays 9am–5pm'."
            error={handoff.fieldErrors?.humanHoursNote}
          >
            <Input
              name="humanHoursNote"
              defaultValue={client.humanHoursNote ?? ""}
              placeholder="Weekdays 9am–5pm"
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={handoffPending}>Save</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Owner-only: the code staff enter to unlock AI editing. */
export function EditCodeForm({ client, isAdmin = true }: { client: Client; isAdmin?: boolean }) {
  const [editCode, editCodeAction, editCodePending] = useActionState(
    setEditCodeAction,
    initialActionState,
  );
  useSavedToast(editCode, "Saved.");
  if (!isAdmin) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team edit code</CardTitle>
        <CardDescription>
          Staff you invite can see calls, leads, and bookings, but changes to your AI
          (knowledge, services, hours, greeting) stay locked. Set a code of your choice and
          share it with staff you trust — entering it unlocks editing for 12 hours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={editCodeAction} className="space-y-4">
          <input type="hidden" name="clientId" value={client.id} />
          <Field
            label="Edit code"
            hint="4–40 characters. Save empty to turn staff editing off entirely."
            error={editCode.fieldErrors?.code}
          >
            <Input
              name="code"
              type="text"
              placeholder={client.editCodeHash ? "••••••  (set — enter a new one to change)" : "e.g. front-desk-2026"}
              autoComplete="off"
            />
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={editCodePending}>Save code</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Automatic follow-up texts to cold leads and no-shows. */
export function RecoveryTextsForm({ client }: { client: Client }) {
  const [recovery, recoveryAction, recoveryPending] = useActionState(
    savePortalProfileAction,
    initialActionState,
  );
  useSavedToast(recovery, "Recovery settings saved.");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recovery texts</CardTitle>
        <CardDescription>
          When on, your AI follows up by text with leads that never booked and customers who
          missed appointments — at most two gentle nudges, during your daytime hours only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={recoveryAction} className="space-y-4">
          <input type="hidden" name="clientId" value={client.id} />
          <Field
            label="Automatically chase missed revenue"
            hint="You can see every text it sends on your Leads page. Marking a lead won or lost stops the follow-ups."
          >
            <NativeSelect
              name="outboundRecoveryEnabled"
              defaultValue={client.outboundRecoveryEnabled ? "on" : "off"}
            >
              <option value="off">Off — I&apos;ll follow up myself</option>
              <option value="on">On — recover cold leads and no-shows for me</option>
            </NativeSelect>
          </Field>
          <div className="flex justify-end">
            <SubmitButton pending={recoveryPending}>Save</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** "Get help" — a note to support by email. */
export function HelpForm({ client }: { client: Client }) {
  const [help, helpAction, helpPending] = useActionState(contactSupportAction, initialActionState);
  const helpFormRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (help.ok) {
      toast.success("Message sent — we'll get back to you by email.");
      helpFormRef.current?.reset();
    } else if (help.error) {
      toast.error(help.error);
    }
  }, [help]);
  return (
    <Card id="help" className="scroll-mt-24">
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
  );
}
