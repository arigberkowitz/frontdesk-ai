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
        <section className="mx-auto max-w-3xl px-4 pb-6 pt-16 text-center sm:px-6">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
            <Sparkles className="size-3.5" /> AI receptionist for local business
          </span>
          <h1 className="mt-4 font-heading text-5xl font-semibold leading-[1.02] tracking-[-0.025em] sm:text-7xl">
            Never miss
            <br />
            <em className="font-medium">another call.</em>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
            Your AI receptionist answers every call, books appointments straight to your calendar,
            and captures every lead — 24/7, in English and Spanish, for a fraction of a hire.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button size="lg" nativeButton={false} render={<Link href="/sign-up" />}>
              <ArrowRight className="size-4" />
              Get started free
            </Button>
            <Button size="lg" variant="outline" nativeButton={false} render={<Link href="#how" />}>
              See how it works
            </Button>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t pt-5 text-xs text-muted-foreground sm:text-sm">
            <span>Picks up on the first ring</span>
            <span aria-hidden className="hidden text-border sm:inline">·</span>
            <span>Books on the call</span>
            <span aria-hidden className="hidden text-border sm:inline">·</span>
            <span>English y Español</span>
          </div>
        </section>

        <section className="mx-auto max-w-lg px-4 pb-16 sm:px-6">
          <p className="fd-section-label mb-3 text-center">Hear it answer</p>
          <DemoCall />
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
                One price per location. A 14-day free trial — no charge until you go live.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      + {formatCurrencyCents(plan.setupFeeCents)} one-time setup
                    </p>
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
              Set up your AI receptionist today — most businesses are live the same afternoon.
            </p>
            <div className="mt-7 flex justify-center">
              <Button size="lg" nativeButton={false} render={<Link href="/sign-up" />}>
                <ArrowRight className="size-4" />
                Get started free
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
            <Link href="/sign-in" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/sign-up" className="hover:text-foreground">
              Get started
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
