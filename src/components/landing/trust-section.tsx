import Link from "next/link";
import { Download, MessageSquareOff, PhoneCall, ShieldCheck, UserCheck } from "lucide-react";
import { publishableTestimonials } from "@/config/trust";
import { formatPhone } from "@/lib/format";

/**
 * "Why should I trust this?" — answered with things a visitor can check, not
 * adjectives. Three parts:
 *
 * 1. A live demo line (when DEMO_PHONE_NUMBER is set) — the strongest proof a
 *    voice product has. Without one, the fallback is an honest "ask us".
 * 2. Customer quotes — rendered ONLY from src/config/trust.ts, which ships
 *    empty. Nothing here is invented; the block is invisible until real,
 *    permissioned quotes exist.
 * 3. How it treats your customers — commitments that are true of the product
 *    today, each backed by code (see the PR that added this section).
 */
const COMMITMENTS = [
  {
    icon: UserCheck,
    title: "Says it's an AI",
    body: "Callers are told they're talking to your business's AI assistant. It doesn't pretend to be a person.",
  },
  {
    icon: MessageSquareOff,
    title: "STOP means stop",
    body: "Anyone who replies STOP stops getting texts from us, for every business we serve, unless they text START again.",
  },
  {
    icon: ShieldCheck,
    title: "You approve changes",
    body: "Suggested improvements to what your receptionist says wait for your OK before they reach your phone line.",
  },
  {
    icon: Download,
    title: "Your leads are yours",
    body: "Export every captured lead to a spreadsheet whenever you like.",
  },
] as const;

export function TrustSection({ demoPhone }: { demoPhone?: string | null }) {
  const quotes = publishableTestimonials();
  const phone = demoPhone?.trim();

  return (
    <section id="proof" className="border-t">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="text-center">
          <p className="fd-section-label">Proof, not promises</p>
          <h2 className="mt-2 font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Hear it before you trust it
          </h2>
        </div>

        <div className="mt-10 rounded-2xl border bg-card p-6 text-center sm:p-8">
          <PhoneCall className="mx-auto size-6 text-indigo-500" aria-hidden />
          {phone ? (
            <>
              <p className="mt-3 font-medium">Call our demo line and talk to it yourself</p>
              <a
                href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                className="mt-2 inline-block font-heading text-2xl font-semibold tracking-tight underline-offset-4 hover:underline"
              >
                {formatPhone(phone)}
              </a>
              <p className="mt-2 text-sm text-muted-foreground">
                Ask it what a customer would: hours, prices, or to book a time.
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 font-medium">Want to hear it on a real call?</p>
              <p className="mt-2 text-sm text-muted-foreground">
                <Link href="/contact" className="font-medium text-foreground underline underline-offset-4">
                  Get in touch
                </Link>{" "}
                and we&apos;ll set you up with a live demo.
              </p>
            </>
          )}
        </div>

        {quotes.length > 0 ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {quotes.map((t) => (
              <figure key={`${t.name}-${t.business}`} className="rounded-2xl border bg-card p-5">
                <blockquote className="text-sm leading-relaxed">&ldquo;{t.quote}&rdquo;</blockquote>
                <figcaption className="mt-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{t.name}</span> · {t.business}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}

        <div className="mt-10">
          <h3 className="text-center font-medium">How it treats your customers</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {COMMITMENTS.map((c) => (
              <div key={c.title} className="rounded-2xl border bg-card p-5">
                <c.icon className="size-5 text-emerald-600" aria-hidden />
                <p className="mt-3 font-medium">{c.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            Read the details:{" "}
            <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
              Privacy
            </Link>{" "}
            ·{" "}
            <Link href="/sms-consent" className="underline underline-offset-4 hover:text-foreground">
              SMS consent
            </Link>{" "}
            ·{" "}
            <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
              Terms
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
