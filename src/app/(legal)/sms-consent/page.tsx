import type { Metadata } from "next";
import { env } from "@/lib/env";
import { QUOTE_CONSENT_QUESTION } from "@/lib/revenue/quote-consent";
import { FOLLOWUP_CONSENT_QUESTION, MESSAGE_CONSENT_QUESTION } from "@/lib/text-consent-asks";

export const metadata: Metadata = {
  title: "SMS Consent & Messaging Policy",
  // One canonical copy — the app also answers on the old *.vercel.app URL.
  alternates: { canonical: `${env.APP_URL.replace(/\/$/, "")}/sms-consent` },
};

const UPDATED = "November 27, 2026";

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
            FrontDesk AI provides an AI phone receptionist to small businesses. When you call a
            business that uses the service, the business may send you text messages, but only the
            kinds you agreed to on that call. There are four kinds, each with its own yes:{" "}
            <strong>booking texts</strong>, <strong>message texts</strong>,{" "}
            <strong>quote follow-up</strong>, and <strong>follow-up texts</strong> (win-back,
            review requests and &ldquo;you&rsquo;re due&rdquo; reminders). Agreeing to one never
            signs you up for another.
          </p>
        </Section>

        <Section title="2. How consent is collected (verbal opt-in on the call)">
          <p>
            Consent is collected <strong>verbally, during the phone call you placed to the
            business</strong>. The AI receptionist asks for your mobile number, reads it back, and
            then asks permission as a separate question. Only a clear yes counts; giving your
            number is not agreement, and the AI asks once and never pushes. Each yes is recorded
            with the time, the call, and the exact question you were asked.
          </p>
          <p>
            <strong>Booking texts.</strong> When you book an appointment, the AI asks:
          </p>
          <p className="rounded-lg border bg-muted/40 p-4 italic">
            &ldquo;Would you like me to text you the confirmation, a reminder, and a quick follow-up about this visit? Message and data
            rates may apply, and you can reply STOP at any time to opt out.&rdquo;
          </p>
          <p>
            <strong>Message texts</strong> (only if the business turns this on). When you leave a
            message and don&rsquo;t book, the AI may ask:
          </p>
          <p className="rounded-lg border bg-muted/40 p-4 italic">&ldquo;{MESSAGE_CONSENT_QUESTION}&rdquo;</p>
          <p>
            <strong>Quote follow-up</strong> (only if the business turns this on). When you ask for
            a price or quote and don&rsquo;t book, the AI may ask:
          </p>
          <p className="rounded-lg border bg-muted/40 p-4 italic">&ldquo;{QUOTE_CONSENT_QUESTION}&rdquo;</p>
          <p>
            <strong>Follow-up texts</strong> (only if the business turns this on). After you agree
            to booking texts, the AI may ask one more, optional question:
          </p>
          <p className="rounded-lg border bg-muted/40 p-4 italic">&ldquo;{FOLLOWUP_CONSENT_QUESTION}&rdquo;</p>
          <p>
            A caller who texts the business&rsquo;s number first also consents to receive a reply
            to that message. Consent is collected per business; opting in with one business does
            not opt you in with any other. Messages are delivered from a FrontDesk AI messaging
            number operated on behalf of the business, and every message names the business it is
            sent for. <strong>Consent to receive texts is not a condition of purchasing any goods
            or services</strong>; you can book, leave a message or get a quote without agreeing.
          </p>
        </Section>

        <Section title="3. What you'll receive">
          <p>Every message is about a call you placed, and only the kinds you agreed to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Booking texts:</strong> the confirmation and reminders for an appointment you
              booked, a reschedule notice if the business has to move it, and one follow-up about
              that visit. Typically 1&ndash;4 texts per booking.
            </li>
            <li>
              <strong>Message texts:</strong> a reply about the message you left, and, if a later
              call to the business drops before you&rsquo;re helped, one text asking when works for
              you. Sent only if you agreed to booking or message texts with that business.
            </li>
            <li>
              <strong>Quote follow-up:</strong> at most two texts about the price you asked for,
              about a day and a week after the call. Stops as soon as you book, reply or text STOP.
            </li>
            <li>
              <strong>Follow-up texts:</strong> asking how your visit went (which may ask for a
              review), letting you know when you&rsquo;re due again, or checking in if it&rsquo;s
              been a while. No more than a couple a month, and at most one every few weeks per
              business. Sent only if you said yes to the follow-up question; a yes to booking texts
              alone never covers these.
            </li>
            <li>
              <strong>Waitlist and deposit texts:</strong> only when you asked to join a waitlist or a
              deposit is needed to hold your booking.
            </li>
            <li><strong>Replies</strong> to messages you send the business.</li>
          </ul>
          <p>
            <strong>Message frequency varies.</strong> <strong>Message and data rates may
            apply.</strong> Example message:
          </p>
          <p className="rounded-lg border bg-muted/40 p-4 italic">
            &ldquo;Hi Jamie, a reminder of your appointment with Ace Plumbing on Tue, Aug 4 at
            2:30 PM. Need to reschedule? Give Ace Plumbing a call. Reply STOP to opt out.&rdquo;
          </p>
        </Section>

        <Section title="4. Opting out and getting help">
          <p>
            Reply <strong>STOP</strong> to any message to opt out of all of them — you&rsquo;ll receive one final
            confirmation that you&rsquo;ve been unsubscribed, and no further messages will be sent.
            Because messages for participating businesses are delivered from a shared FrontDesk AI
            messaging number, replying STOP stops texts sent through that number on behalf of{" "}
            <strong>any</strong> participating business, until you reply START. Reply{" "}
            <strong>START</strong> to re-subscribe; you&rsquo;ll get one text confirming it. Reply <strong>HELP</strong> for help (the
            reply includes how to opt out and that message and data rates may apply), or contact the
            business directly.
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
