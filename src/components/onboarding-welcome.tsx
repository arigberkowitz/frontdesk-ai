"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarCheck, Globe, MessageSquare, Phone, Sparkles } from "lucide-react";
import { createStarterClientAction } from "@/lib/actions/clients";
import { onboardFromWebsitePortalAction } from "@/lib/actions/onboard";
import { initialActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";

const STEPS = [
  { icon: Phone, title: "Answers every call", body: "24/7, on the first ring — nights, weekends, lunch rushes." },
  { icon: CalendarCheck, title: "Books appointments", body: "Checks your hours and schedules customers right on the call." },
  { icon: MessageSquare, title: "Never loses a lead", body: "Takes a message with name, number, and reason — and alerts you." },
];

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

/** Draft the whole receptionist from the company's own website. */
function WebsiteForm() {
  const [state, action] = useActionState(onboardFromWebsitePortalAction, initialActionState);
  return (
    <form action={action} className="space-y-3 text-left">
      <Field label="Business name" error={state.fieldErrors?.name}>
        <Input name="name" placeholder="Bright Smile Dental" required />
      </Field>
      <Field label="Website" error={state.fieldErrors?.websiteUrl}>
        <Input name="websiteUrl" type="url" placeholder="https://yourbusiness.com" required />
      </Field>
      <SubmitButton idle="Draft my receptionist from my website" busy="Reading your website…" />
    </form>
  );
}

/** First screen a brand-new company sees (empty workspace) — guided setup, not a blank dashboard. */
export function OnboardingWelcome({ aiReady }: { aiReady: boolean }) {
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-6 text-center">
      <div className="space-y-3">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Phone className="size-6" />
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Welcome to FrontDesk AI</h1>
        <p className="mx-auto max-w-lg text-muted-foreground">
          Your AI receptionist answers every call, books appointments, and takes messages — around the
          clock. Let&apos;s get yours set up. It only takes a couple of minutes.
        </p>
      </div>

      <div className="grid gap-3 text-left sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.title} className="rounded-xl border p-4">
            <s.icon className="size-5 text-primary" />
            <p className="mt-2 text-sm font-medium">{s.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      {aiReady ? (
        <div className="space-y-5">
          <div className="rounded-2xl border bg-muted/30 p-5 text-left">
            <div className="mb-3 flex items-center gap-2">
              <Globe className="size-5 text-primary" />
              <p className="font-medium">Start from your website</p>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Paste your site and we&apos;ll read it to draft your services, hours, and FAQs — you just
              review and tweak. Fastest way to a receptionist that already knows your business.
            </p>
            <WebsiteForm />
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <div className="flex flex-col items-center gap-2">
            <form action={createStarterClientAction}>
              <SubmitButton idle="Start from a template instead" busy="Setting it up…" />
            </form>
            <p className="max-w-md text-xs text-muted-foreground">
              We&apos;ll pre-fill example services, hours, and FAQs you can edit to match your business.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <form action={createStarterClientAction}>
            <Button type="submit" size="lg">
              <Sparkles className="size-4" />
              Set up my receptionist
            </Button>
          </form>
          <p className="max-w-md text-xs text-muted-foreground">
            We&apos;ll start you off with example services, hours, and FAQs already filled in — just edit
            each one to match your business.
          </p>
        </div>
      )}
    </div>
  );
}
