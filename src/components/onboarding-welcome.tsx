"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarCheck, Globe, MessageSquare, Phone, Sparkles } from "lucide-react";
import { createStarterClientAction } from "@/lib/actions/clients";
import { onboardFromWebsitePortalAction } from "@/lib/actions/onboard";
import { initialActionState } from "@/lib/actions/types";
import { INDUSTRIES } from "@/config/options";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { DemoCall } from "@/components/demo-call";

const STEPS = [
  {
    icon: Phone,
    chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    title: "Answers every call",
    body: "24/7, on the first ring — nights, weekends, lunch rushes.",
  },
  {
    icon: CalendarCheck,
    chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    title: "Books appointments",
    body: "Checks your hours and schedules customers right on the call.",
  },
  {
    icon: MessageSquare,
    chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    title: "Never loses a lead",
    body: "Takes a message with name, number, and reason — and alerts you.",
  },
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
/** Browser-detected IANA timezone, read at submit time (empty during SSR is fine —
 *  the server action falls back to the platform default). */
function TimezoneField() {
  return (
    <input
      type="hidden"
      name="timezone"
      ref={(el) => {
        if (el) el.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
      }}
    />
  );
}

/** Industry picker feeding the starter packs — value must match INDUSTRIES. */
function IndustrySelect() {
  return (
    <NativeSelect name="industry" defaultValue="" className="h-9">
      <option value="">Pick one (or skip)…</option>
      {INDUSTRIES.map((i) => (
        <option key={i} value={i}>
          {i}
        </option>
      ))}
    </NativeSelect>
  );
}

/** ONE form, one name field: the primary button drafts from the website (or a
 *  blank manual setup), the secondary starts from an editable template. After
 *  either, the portal checklist walks the owner through the rest step by step. */
function SetupForm() {
  const [state, action] = useActionState(onboardFromWebsitePortalAction, initialActionState);
  return (
    <form action={action} className="space-y-3 text-left">
      <TimezoneField />
      <Field label="Business name" error={state.fieldErrors?.name}>
        <Input name="name" placeholder="Bright Smile Dental" required />
      </Field>
      <Field
        label="What kind of business?"
        hint="Starts you with real services, hours, and FAQs for your industry — all editable."
      >
        <IndustrySelect />
      </Field>
      <Field
        label="Website (optional)"
        hint="Have one? We'll read it and draft your services, hours, and FAQ for you."
        error={state.fieldErrors?.websiteUrl}
      >
        <Input name="websiteUrl" type="url" placeholder="https://yourbusiness.com" />
      </Field>
      <Field
        label="Who's answering the phones?"
        hint="Shapes your setup — solo keeps it simple, teams get per-person booking."
      >
        <select
          name="companySize"
          defaultValue="solo"
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="solo">Just me</option>
          <option value="team">A small team (2–10)</option>
          <option value="big">A bigger operation</option>
        </select>
      </Field>
      <SubmitButton idle="Set up my receptionist" busy="Setting up…" />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="w-full text-muted-foreground"
        formAction={createStarterClientAction}
      >
        Or start from a pre-filled template instead
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Either way, a short checklist walks you through the rest — and you can change anything
        later.
      </p>
    </form>
  );
}

/** First screen a brand-new company sees (empty workspace) — guided setup, not a blank dashboard. */
export function OnboardingWelcome({ aiReady }: { aiReady: boolean }) {
  return (
    <div className="mx-auto max-w-2xl space-y-8 py-6 text-center">
      <div className="space-y-3">
        <div
          className="mx-auto flex size-12 items-center justify-center rounded-2xl text-white"
          style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
        >
          <Phone className="size-6" />
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Welcome to FrontDesk AI</h1>
        <p className="mx-auto max-w-lg text-muted-foreground">
          Your AI receptionist answers every call, books appointments, and takes messages — around the
          clock. Let&apos;s get yours set up. It only takes a couple of minutes.
        </p>
      </div>

      {aiReady ? (
        <div className="rounded-2xl border bg-muted/30 p-5 text-left">
          <div className="mb-3 flex items-center gap-2">
            <Globe className="size-5 text-primary" />
            <p className="font-medium">Two quick questions and you&apos;re in</p>
          </div>
          <SetupForm />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <form action={createStarterClientAction} className="w-full max-w-sm space-y-3 text-left">
            <TimezoneField />
            <Field label="What kind of business?">
              <IndustrySelect />
            </Field>
            <Button type="submit" size="lg" className="w-full">
              <Sparkles className="size-4" />
              Set up my receptionist
            </Button>
          </form>
          <p className="max-w-md text-xs text-muted-foreground">
            We&apos;ll start you off with services, hours, and FAQs for your industry already filled
            in — just edit each one to match your business.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-sm font-medium">Here&apos;s your AI receptionist in action</p>
        <DemoCall />
      </div>

      <div className="grid gap-3 text-left sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.title} className="rounded-xl border bg-card p-4">
            <span className={`flex size-9 items-center justify-center rounded-lg ${s.chip}`}>
              <s.icon className="size-4" />
            </span>
            <p className="mt-3 text-sm font-medium">{s.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
