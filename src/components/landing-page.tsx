import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  Clock,
  Languages,
  MessageSquare,
  Phone,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DemoCall } from "@/components/demo-call";
import { planList } from "@/config/plans";
import { formatCurrencyCents } from "@/lib/format";

const VALUE = [
  { icon: Clock, chip: "bg-sky-500/10 text-sky-600 dark:text-sky-400", title: "Answers 24/7", body: "Every call picked up on the first ring — nights, weekends, lunch rushes." },
  { icon: CalendarCheck, chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", title: "Books on the call", body: "Checks your hours and schedules the appointment live, straight into your calendar." },
  { icon: MessageSquare, chip: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", title: "Never loses a lead", body: "Captures name, number, and reason — and texts you the moment it happens." },
  { icon: Languages, chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400", title: "English & Spanish", body: "Switches to fluent Spanish the second a caller speaks it — no extra staff." },
];

const STEPS = [
  { n: "1", title: "Set it up in minutes", body: "Paste your website — we draft your services, hours, and FAQs. Review and tweak." },
  { n: "2", title: "It answers every call", body: "Your AI greets callers, answers questions, books appointments, and takes messages 24/7." },
  { n: "3", title: "You see everything", body: "Bookings hit your calendar; leads, recordings, and summaries land in one dashboard." },
];

/** Structured data so search engines understand the product + pricing. */
function jsonLd() {
  const plans = planList();
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "FrontDesk AI",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description:
      "AI phone receptionist for local service businesses — answers every call, books appointments, and captures leads 24/7 in English and Spanish.",
    offers: plans.map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: (p.monthlyPriceCents / 100).toFixed(0),
      priceCurrency: "USD",
    })),
  };
}

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd()) }}
      />
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <div
            className="flex size-8 items-center justify-center rounded-lg text-white"
            style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
          >
            <Phone className="size-4" />
          </div>
          <span className="font-heading text-lg font-semibold tracking-tight">FrontDesk AI</span>
          <nav className="ml-6 hidden items-center gap-5 text-sm text-muted-foreground sm:flex">
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#pricing" className="transition-colors hover:text-foreground">
              Pricing
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/sign-in" />}>
              Sign in
            </Button>
            <Button size="sm" nativeButton={false} render={<Link href="/sign-up" />}>
              Get started
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/*
          The demo IS the pitch. It used to sit in a small section below the
          fold, so the one thing that convinces anyone — hearing the AI handle a
          real booking — was something you had to scroll to find. It's in the
          hero now, side by side with the claim it proves.
        */}
        <section className="relative overflow-hidden">
          {/* Brand glow. Pure decoration, so it's hidden from assistive tech and
              sits behind everything at low opacity. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute left-1/2 top-[-12rem] h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-indigo-500/20 blur-[120px]" />
            <div className="absolute right-[-8rem] top-[6rem] h-[26rem] w-[26rem] rounded-full bg-emerald-500/20 blur-[120px]" />
          </div>

          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pt-20">
            <div className="text-center lg:text-left">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                <Sparkles className="size-3.5" /> AI receptionist for local business
              </span>
              <h1 className="mt-4 font-heading text-5xl font-semibold leading-[1.02] tracking-[-0.025em] sm:text-6xl lg:text-7xl">
                Never miss
                <br />
                <em className="font-medium">another call.</em>
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-balance text-base text-muted-foreground sm:text-lg lg:mx-0">
                Every call answered on the first ring. Appointments booked straight into your
                calendar. Every lead captured — 24/7, in English and Spanish, for a fraction of a
                hire.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3 lg:justify-start">
                <Button size="lg" nativeButton={false} render={<Link href="/sign-up" />}>
                  <ArrowRight className="size-4" />
                  Get started
                </Button>
                <Button size="lg" variant="outline" nativeButton={false} render={<Link href="#how" />}>
                  See how it works
                </Button>
              </div>
              <ul className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t pt-5 text-sm text-muted-foreground lg:justify-start">
                {["Picks up on the first ring", "Books on the call", "English y Español"].map(
                  (item) => (
                    <li key={item} className="flex items-center gap-1.5">
                      <Check className="size-4 shrink-0 text-emerald-500" />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>

            <div className="relative">
              <p className="fd-section-label mb-3 text-center lg:text-left">
                {/* It is a written sample, not a recording — and the panel's own
                    chip says "sample" six lines below. Calling it real was the
                    one unqualified factual claim on this page that wasn't. */}
                Here&apos;s how a call goes, start to finish
              </p>
              <DemoCall />
            </div>
          </div>
        </section>

        <section className="border-t bg-card/40">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
            <div className="fd-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {VALUE.map((v) => (
                <div key={v.title} className="fd-lift rounded-xl border bg-card p-5">
                  <span className={`flex size-9 items-center justify-center rounded-lg ${v.chip}`}>
                    <v.icon className="size-4" />
                  </span>
                  <p className="mt-3 font-medium">{v.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{v.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <div className="text-center">
            <p className="fd-section-label">How it works</p>
            <h2 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Live in a day, not a quarter
            </h2>
            <p className="mt-2 text-muted-foreground">
              Three steps from signup to a phone that answers itself.
            </p>
          </div>
          <div className="fd-stagger mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div
                key={s.n}
                className={`border-t-2 pt-4 ${i === 0 ? "border-indigo-500" : "border-border"}`}
              >
                <span
                  className={`font-heading text-3xl font-medium leading-none ${
                    i === 0 ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground"
                  }`}
                >
                  {s.n}
                </span>
                <p className="mt-3 font-medium">{s.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="border-t bg-card/40">
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
            <div className="text-center">
              <p className="fd-section-label">Pricing</p>
              <h2 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Simple, flat pricing
              </h2>
              <p className="mt-2 text-muted-foreground">
                Three weeks free, no card. One price per location after that, and no setup fee —
                ever.{" "}
                <Link href="/contact" className="underline underline-offset-2">
                  Questions?
                </Link>
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {planList().map((plan) => {
                const featured = plan.key === "pro";
                return (
                  <div
                    key={plan.key}
                    className={`rounded-xl border bg-card p-6 ${featured ? "shadow-lg ring-2 ring-indigo-500" : ""}`}
                  >
                    {featured ? (
                      <span className="inline-block rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                        Most popular
                      </span>
                    ) : null}
                    <p className={`font-heading text-xl font-semibold ${featured ? "mt-2" : ""}`}>
                      {plan.name}
                    </p>
                    <p className="mt-2">
                      <span className="font-heading text-3xl font-semibold tracking-tight">
                        {formatCurrencyCents(plan.monthlyPriceCents)}
                      </span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </p>
                    {/* The setup fee is what we charge to set a business up. A
                        business signing up here sets itself up, so it isn't
                        charged one — and these cards used to advertise up to
                        $1,500 of it against a checkout that no visitor could
                        even reach. */}
                    <p className="mt-1 text-xs text-muted-foreground">No setup fee</p>
                    <ul className="mt-4 space-y-2">
                      {plan.highlights.map((h) => (
                        <li key={h} className="flex items-start gap-2 text-sm">
                          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          {h}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="mt-6 w-full"
                      variant={featured ? "default" : "outline"}
                      nativeButton={false}
                      render={<Link href="/sign-up" />}
                    >
                      Get started
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/[0.04] px-6 py-14 text-center sm:px-12">
            <h2 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Stop sending customers <em className="font-medium">to voicemail.</em>
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-balance text-muted-foreground">
              Three weeks free, no card. Most businesses are live the same afternoon.
            </p>
            <div className="mt-7 flex justify-center">
              <Button size="lg" nativeButton={false} render={<Link href="/sign-up" />}>
                <ArrowRight className="size-4" />
                Get started
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span className="flex items-center gap-2">
            <span
              className="flex size-5 items-center justify-center rounded text-white"
              style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
            >
              <Phone className="size-3" />
            </span>
            © {new Date().getFullYear()} FrontDesk AI
          </span>
          <span className="flex gap-4">
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            {/* The A2P campaign's call-to-action points reviewers here to check
                how text consent is collected. It was reachable only from
                another legal page — two hops from anywhere they'd land. */}
            <Link href="/sms-consent" className="hover:text-foreground">
              SMS consent
            </Link>
            <Link href="/sign-in" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/sign-up" className="hover:text-foreground">
              Get started
            </Link>
          </span>
        </div>
        {/* Paying is self-serve; a free trial isn't. That makes this the only
            route to one, so it can't be buried in a row of small links. */}
        <div className="border-t">
          <p className="mx-auto max-w-5xl px-4 py-6 text-center text-sm text-muted-foreground sm:px-6">
            Questions, or want a free trial before you pay?{" "}
            <Link href="/contact" className="font-medium text-foreground underline underline-offset-4">
              Get in touch
            </Link>{" "}
            — a real person reads every one.
          </p>
        </div>
      </footer>
    </div>
  );
}
