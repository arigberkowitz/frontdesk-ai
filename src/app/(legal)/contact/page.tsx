import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { ContactForm } from "@/components/contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about FrontDesk AI, or want a free trial? Get in touch.",
};

/**
 * The page that exists because "free" stopped being self-serve.
 *
 * Signing up and paying is now something a business does on its own. A free
 * trial is something we hand out deliberately, which means there has to be a
 * way to ask — and until now the only route was a code box asking for a code
 * nobody had been given.
 */
const EMAIL = "arigberkowitz@gmail.com";

export default function ContactPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Get in touch</h1>
        <p className="text-muted-foreground">
          A real person reads these — usually the one who built it.
        </p>
      </div>

      <ContactForm ownerEmail={EMAIL} />

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Mail className="size-4 shrink-0" />
        Or write to{" "}
        <a href={`mailto:${EMAIL}?subject=FrontDesk%20AI`} className="underline underline-offset-2">
          {EMAIL}
        </a>
      </p>

      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          <strong className="text-foreground">Want to try it free first?</strong> Say so and we&apos;ll
          set you up with a trial code — the whole product, every feature, nothing to pay and no card
          needed. It&apos;s not a button on the site because we&apos;d rather know who&apos;s using
          it and help you get the first calls right.
        </p>
        <p>
          <strong className="text-foreground">Ready to go?</strong> You don&apos;t need us for that.{" "}
          <Link href="/sign-up" className="underline underline-offset-2">
            Sign up
          </Link>
          , build your receptionist, and pick a plan when you&apos;re ready to switch it on. There&apos;s
          no setup fee when you set it up yourself.
        </p>
        <p>
          <strong className="text-foreground">Something not working?</strong> Tell us what happened
          and roughly when. If it was a phone call, the time and the number that called is enough for
          us to pull the recording and see it for ourselves.
        </p>
        <p>
          <strong className="text-foreground">Stop receiving texts?</strong> Reply STOP to any message
          and the carrier blocks it immediately — you don&apos;t need to email anyone for that. See{" "}
          <Link href="/sms-consent" className="underline underline-offset-2">
            SMS consent
          </Link>{" "}
          for how messaging works.
        </p>
      </div>
    </div>
  );
}
