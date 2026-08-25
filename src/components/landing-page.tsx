import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  Check,
  ChevronDown,
  Clock,
  Languages,
  MessageSquare,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DemoCall } from "@/components/demo-call";
import { planList, minutesLabel } from "@/config/plans";
import { formatCurrencyCents, formatPhone } from "@/lib/format";
import { env } from "@/lib/env";

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

/**
 * The five questions every skeptical owner is already asking by the time they
 * reach the pricing cards. Each answer is a fact about how the product
 * actually works — nothing here promises anything the agent doesn't do.
 */
const FAQ = [
  {
    q: "Do I keep my phone number?",
    a: "Yes. Your existing business number forwards to your AI — you dial *72 from your phone to turn it on. Dial *73 and forwarding is off, and calls ring your phone exactly like before. No new number, no new hardware.",
  },
  {
    q: "What happens when it can't answer something?",
    a: "It never guesses. It takes the caller's name, number, and what they needed, and texts you right away so you can follow up. Anything urgent — or anyone who asks for a person — gets transferred live to your cell.",
  },
  {
    q: "Am I locked into a contract?",
    a: "No. Every plan is month to month with no setup fee, and the trial is three weeks with no card. If you leave, your phone works the way it did before you found us.",
  },
  {
    q: "Will callers know they're talking to an AI?",
    a: "It introduces itself by name as your AI assistant and never pretends to be a person. What callers remember is that someone answered on the first ring at 9pm — not who.",
  },
  {
    q: "What about Spanish-speaking customers?",
    a: "The moment a caller speaks Spanish, it answers in fluent Spanish — every plan, no extra cost, no setup.",
  },
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
      priceCurrency: "USD",
      // Without the billing period, search engines surfaced "$149" as the
      // price of the product rather than the price of a month.
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: (p.monthlyPriceCents / 100).toFixed(0),
        priceCurrency: "USD",
        unitText: "MONTH",
      },
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
        {/*
          The dark stage. The page opens inside a deep-navy rounded panel —
          aurora glow drifting behind glass — so the first screen feels like a
          product, not a pamphlet. The sticky header and the reading sections
          below stay light; drama is for the opening and closing acts only.
        */}
        <section className="px-3 pt-3 sm:px-4">
          <div className="fd-stage rounded-3xl">
            <div
              aria-hidden
              className="fd-aurora left-[55%] top-[-14rem] h-[34rem] w-[34rem] bg-indigo-500/30"
            />
            <div
              aria-hidden
              className="fd-aurora left-[-10rem] bottom-[-12rem] h-[28rem] w-[28rem] bg-emerald-500/20 [animation-delay:-8s]"
            />

            <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pb-20 lg:pt-24">
              <div className="text-center lg:text-left">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-indigo-200 backdrop-blur">
                  <Phone className="size-3.5" /> AI receptionist for local business
                </span>
                <h1 className="mt-5 font-heading text-5xl font-semibold leading-[1.02] tracking-[-0.025em] text-white sm:text-6xl lg:text-7xl">
                  Never miss
                  <br />
                  <em className="fd-gradient-text font-medium">another call.</em>
                </h1>
                <p className="mx-auto mt-5 max-w-xl text-balance text-base text-slate-300 sm:text-lg lg:mx-0">
                  Every call answered on the first ring. Appointments booked straight into your
                  calendar. Every lead captured — 24/7, in English and Spanish, for a fraction of a
                  hire.
                </p>
                <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
                  <Button
                    size="lg"
                    className="fd-cta-glow"
                    nativeButton={false}
                    render={<Link href="/sign-up" />}
                  >
                    <ArrowRight className="size-4" />
                    Get started free
                  </Button>
                  <Button
                    size="lg"
                    className="fd-cta-ghost"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="#how" />}
                  >
                    See how it works
                  </Button>
                </div>
                {/* The one thing no competitor's landing page can fake: a number
                    that answers. Renders only when DEMO_PHONE_NUMBER is set — a
                    dead number in the hero would be worse than none. */}
                {env.DEMO_PHONE_NUMBER ? (
                  <a
                    href={`tel:${env.DEMO_PHONE_NUMBER.replace(/[^\d+]/g, "")}`}
                    className="fd-lift mt-6 inline-flex items-center gap-3 rounded-full border border-white/15 bg-white/[0.06] py-2.5 pl-4 pr-5 text-sm text-slate-200 backdrop-blur"
                  >
                    <span className="fd-live-dot" aria-hidden="true" />
                    <span>
                      <span className="text-slate-400">Don&apos;t take our word for it — </span>
                      <span className="font-semibold text-white">
                        call {formatPhone(env.DEMO_PHONE_NUMBER)}
                      </span>
                      <span className="text-slate-400"> and talk to it now</span>
                    </span>
                  </a>
                ) : null}

                <ul className="mt-9 flex flex-wrap justify-center gap-x-5 gap-y-2 border-t border-white/10 pt-5 text-sm text-slate-300 lg:justify-start">
                  {["Picks up on the first ring", "Books on the call", "English y Español"].map(
                    (item) => (
                      <li key={item} className="flex items-center gap-1.5">
                        <Check className="size-4 shrink-0 text-emerald-400" />
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
                <div className="rounded-2xl shadow-[0_24px_80px_rgb(79_70_229/0.35)]">
                  <DemoCall />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
            <div className="fd-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {VALUE.map((v) => (
                <div key={v.title} className="fd-card-glow rounded-2xl border bg-card p-5">
                  <span className={`flex size-11 items-center justify-center rounded-xl ${v.chip}`}>
                    <v.icon className="size-5" />
                  </span>
                  <p className="mt-4 font-medium">{v.title}</p>
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
          <div className="relative mt-12">
            {/* The rail the three step-coins sit on — desktop only. */}
            <div
              aria-hidden
              className="absolute left-0 right-0 top-[1.375rem] hidden h-px bg-gradient-to-r from-indigo-500/40 via-violet-500/30 to-emerald-500/40 sm:block"
            />
            <div className="fd-stagger grid gap-x-8 gap-y-10 sm:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="relative">
                  <span className="fd-step-num">{s.n}</span>
                  <p className="mt-4 font-medium">{s.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              ))}
            </div>
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
            {/*
              Three columns, because there are three plans. The grid was still
              built for four, so on a wide screen the cards were squeezed into
              three quarters of the row with a hole at the end — and each card
              stopped wherever its own feature list ran out, leaving the buttons
              at three different heights. Equal-height cards with the CTA pinned
              to the bottom is the whole fix: prices line up, feature lists line
              up, buttons line up, and the eye can compare across a row instead
              of hunting.
            */}
            <div className="mx-auto mt-12 grid max-w-4xl items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {planList().map((plan) => {
                const featured = plan.key === "pro";
                return (
                  <div
                    key={plan.key}
                    className={`fd-lift relative flex flex-col rounded-2xl border bg-card p-7 ${
                      featured ? "fd-ring-gradient" : ""
                    }`}
                  >
                    {/* Lifted out of the flow so the featured card's heading sits
                        level with the other two instead of an eyebrow's height
                        lower — the thing that made the row look crooked. */}
                    {featured ? (
                      <span className="absolute -top-3 left-7 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-3 py-1 text-xs font-medium text-white shadow-md">
                        Most popular
                      </span>
                    ) : null}

                    <p className="font-heading text-xl font-semibold">{plan.name}</p>
                    <p className="mt-3 flex items-baseline gap-1">
                      <span className="font-heading text-4xl font-semibold tracking-tight">
                        {formatCurrencyCents(plan.monthlyPriceCents)}
                      </span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </p>
                    {/* The setup fee is what we charge to set a business up. A
                        business signing up here sets itself up, so it isn't
                        charged one — and these cards used to advertise up to
                        $1,500 of it against a checkout that no visitor could
                        even reach. */}
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      No setup fee · 3 weeks free
                    </p>
                    {/* Volume, and the flat-rate promise. Every AI receptionist
                        priced near this one meters minutes and bills the
                        overage; this one doesn't, and a card that says only a
                        price loses that argument by never making it. */}
                    <p className="mt-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      {minutesLabel(plan)}
                    </p>

                    <p className="mt-5 border-t pt-5 text-sm text-muted-foreground">
                      {plan.description}
                    </p>

                    <ul className="mt-5 space-y-2.5">
                      {plan.highlights.map((h) => (
                        <li key={h} className="flex items-start gap-2.5 text-sm leading-snug">
                          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          {h}
                        </li>
                      ))}
                    </ul>

                    {/* mt-auto on the wrapper is what keeps all three buttons on
                        one line no matter how many features each plan lists. */}
                    <div className="mt-auto pt-8">
                      <Button
                        className="w-full"
                        size="lg"
                        variant={featured ? "default" : "outline"}
                        nativeButton={false}
                        // Carries the card they clicked all the way to
                        // checkout. Every button here used to be the same
                        // link, so picking Pro on the pricing page and picking
                        // Missed-Call Rescue were literally the same click.
                        render={<Link href={`/sign-up?plan=${plan.key}`} />}
                      >
                        Get started
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              Every plan starts with three weeks free. No card until you decide.
            </p>
          </div>
        </section>

        <section id="faq" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <div className="text-center">
            <p className="fd-section-label">Questions</p>
            <h2 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              The things owners ask us first
            </h2>
          </div>
          {/* Search engines get the same answers via FAQPage markup below. */}
          <div className="fd-stagger mt-10 space-y-3">
            {FAQ.map((item) => (
              <details key={item.q} className="group rounded-xl border bg-card">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 font-medium [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <p className="border-t px-5 py-4 text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: FAQ.map((item) => ({
                  "@type": "Question",
                  name: item.q,
                  acceptedAnswer: { "@type": "Answer", text: item.a },
                })),
              }),
            }}
          />
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-20 pt-4 sm:px-6">
          {/* The closing act matches the opening one: back onto the dark stage. */}
          <div className="fd-stage rounded-3xl px-6 py-16 text-center sm:px-12">
            <div
              aria-hidden
              className="fd-aurora left-1/2 top-[-10rem] h-[24rem] w-[24rem] -translate-x-1/2 bg-violet-500/25"
            />
            <h2 className="relative font-heading text-3xl font-semibold tracking-tight text-balance text-white sm:text-4xl">
              Stop sending customers <em className="fd-gradient-text font-medium">to voicemail.</em>
            </h2>
            <p className="relative mx-auto mt-3 max-w-lg text-balance text-slate-300">
              Three weeks free, no card. Most businesses are live the same afternoon.
            </p>
            <div className="relative mt-8 flex justify-center">
              <Button
                size="lg"
                className="fd-cta-glow"
                nativeButton={false}
                render={<Link href="/sign-up" />}
              >
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
