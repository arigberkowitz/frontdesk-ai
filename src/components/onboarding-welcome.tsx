"use client";

import { useFormStatus } from "react-dom";
import { CalendarCheck, MessageSquare, Phone, Sparkles } from "lucide-react";
import { createStarterClientAction } from "@/lib/actions/clients";
import { Button } from "@/components/ui/button";

const STEPS = [
  { icon: Phone, title: "Answers every call", body: "24/7, on the first ring — nights, weekends, lunch rushes." },
  { icon: CalendarCheck, title: "Books appointments", body: "Checks your hours and schedules customers right on the call." },
  { icon: MessageSquare, title: "Never loses a lead", body: "Takes a message with name, number, and reason — and alerts you." },
];

function StartButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      <Sparkles className="size-4" />
      {pending ? "Setting it up…" : "Set up my receptionist"}
    </Button>
  );
}

/** First screen a brand-new company sees (empty workspace) — guided setup, not a blank dashboard. */
export function OnboardingWelcome() {
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

      <div className="flex flex-col items-center gap-3">
        <form action={createStarterClientAction}>
          <StartButton />
        </form>
        <p className="max-w-md text-xs text-muted-foreground">
          We&apos;ll start you off with example services, hours, and FAQs already filled in — just edit
          each one to match your business.
        </p>
      </div>
    </div>
  );
}
