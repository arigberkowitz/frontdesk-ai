import type { Metadata } from "next";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "SMS Consent & Messaging Policy",
  // One canonical copy — the app also answers on the old *.vercel.app URL.
  alternates: { canonical: `${env.APP_URL.replace(/\/$/, "")}/sms-consent` },
};

const UPDATED = "July 30, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Public SMS consent / messaging policy page. This page exists so A2P 10DLC
 * (TCR) reviewers — and any end user — can verify exactly how text-message
 * consent is collected. Our opt-in is VERBAL, during a phone call answered by
 * a business's AI receptionist, so this page documents the script and flow.
 * Referenced from the campaign's Call to Action / message flow description.
 */
export default function SmsConsentPage() {
  return (
    <article className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          SMS Consent &amp; Messaging Policy
        </h1>
        <p className="text-sm text-muted-foreground">Last updated {UPDATED}</p>
      </div>

      <div className="space-y-10 text-[15px] leading-relaxed text-muted-foreground [&_strong]:text-foreground">
        <Section title="1. Who sends these messages">
          <p>
            FrontDesk AI provides an AI phone receptionist to small businesses. When a caller
            books an appointment or leaves a message with a business that uses the service, the
            business may send that caller text messages — appointment confirmations, appointment
            reminders, and follow-ups the caller asked for. Messages are conversational and
            transactional; <strong>we do not send marketing or promotional texts</strong>.
          </p>
        </Section>

        <Section title="2. How consent is collected (verbal opt-in on the call)">
          <p>
            Consent is collected <strong>verbally, during the phone call the customer placed to
            the business</strong>. When a caller books an appointment or requests a follow-up, the
            AI receptionist asks for their mobile number and asks whether it may text them, for
            example:
          </p>
          <p className="rounded-lg border bg-muted/40 p-4 italic">
            &ldquo;Can I get the best mobile number to text your appointment confirmation and a
            reminder to? &hellip; Great — you&rsquo;ll get a confirmation text shortly, and you can
            reply STOP at any time to opt out.&rdquo;
          </p>
          <p>
            The caller provides their number and agrees on the call before any message is sent.
            A caller who texts the business&rsquo;s number first also consents to receive a reply
            to that message. Consent is collected per business — opting in with one business does
            not opt you in with any other.
          </p>
        </Section>

        <Section title="3. What you'll receive">
          <p>
            Message types: appointment confirmations, appointment reminders, and requested
            follow-ups. <strong>Message frequency varies</strong> with your appointments —
            typically 1&ndash;3 messages per booking. <strong>Message and data rates may
            apply.</strong> Example message:
          </p>
          <p className="rounded-lg border bg-muted/40 p-4 italic">
            &ldquo;Hi Jamie, a friendly reminder of your Cleaning &amp; checkup appointment with
            Bright Smile Dental on Tue, Aug 4 at 2:30 PM. Need to reschedule? Call (415) 555-0142.
            Reply STOP to opt out.&rdquo;
          </p>
        </Section>

        <Section title="4. Opting out and getting help">
          <p>
            Reply <strong>STOP</strong> to any message to opt out — you&rsquo;ll receive one final
            confirmation that you&rsquo;ve been unsubscribed, and no further messages will be sent.
            Reply <strong>START</strong> to re-subscribe. Reply <strong>HELP</strong> for help, or
            contact the business directly at the number shown in the message.
          </p>
        </Section>

        <Section title="5. Privacy">
          <p>
            Phone numbers and text-messaging opt-in data are used only to send the messages
            described above.{" "}
            <strong>
              No mobile information will be shared with third parties or affiliates for marketing or
              promotional purposes. Information sharing to subcontractors in support services, such
              as customer service, is permitted. All other use case categories exclude text
              messaging originator opt-in data and consent; this information will not be shared with
              any third parties.
            </strong>{" "}
            See our{" "}
            <a href="/privacy" className="text-foreground underline underline-offset-2">
              Privacy Policy
            </a>{" "}
            for full details, and our{" "}
            <a href="/terms" className="text-foreground underline underline-offset-2">
              Terms of Service
            </a>
            . Consent to receive texts is not a condition of purchasing any goods or services.
          </p>
        </Section>
      </div>
    </article>
  );
}
