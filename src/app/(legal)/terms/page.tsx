import type { Metadata } from "next";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Terms of Service",
  // One canonical copy — the app also answers on the old *.vercel.app URL.
  alternates: { canonical: `${env.APP_URL.replace(/\/$/, "")}/terms` },
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
 * Terms of service. NOTE FOR THE OPERATOR: this is a solid starting draft, not
 * legal advice — have a lawyer review before selling, and replace the
 * bracketed placeholders (entity name, governing state, contact email).
 */
export default function TermsPage() {
  return (
    <article className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">Last updated {UPDATED}</p>
      </div>

      <div className="space-y-10 text-[15px] leading-relaxed text-muted-foreground [&_strong]:text-foreground">
        <Section title="1. Who we are and what these terms cover">
          <p>
            FrontDesk AI (&ldquo;FrontDesk&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), operated by
            Ari Berkowitz d/b/a FrontDesk AI, provides an AI-powered phone receptionist service that answers
            calls, books appointments, and captures messages for businesses (the
            &ldquo;Service&rdquo;). These terms are a binding agreement between us and the business
            that creates an account (&ldquo;you&rdquo;). By creating an account or using the
            Service you accept these terms.
          </p>
        </Section>

        <Section title="2. The Service">
          <p>
            The Service answers telephone calls directed to a number we provision or that you
            forward to us, converses with callers using artificial intelligence, and may record
            calls, produce transcripts and summaries, schedule appointments on calendars you
            connect, send text messages and emails on your behalf, and analyze calls to suggest
            improvements to your AI receptionist. You control your receptionist&rsquo;s
            configuration — its greeting, knowledge, services, hours, and behavior — and are
            responsible for the accuracy of the information you provide it.
          </p>
        </Section>

        <Section title="3. Your responsibilities">
          <p>
            You must: (a) provide accurate business information; (b) comply with all laws that
            apply to your use of the Service, including telemarketing, call-recording, and consumer
            protection laws in your jurisdiction; (c) ensure any call-recording disclosure required
            in your jurisdiction remains enabled where legally required — the Service provides a
            disclosure mechanism, but confirming its sufficiency for your jurisdiction is your
            responsibility; (d) obtain any consents required to text or call your customers and
            leads; and (e) keep your account credentials secure. You may not use the Service for
            emergency services, illegal robocalling or spam, deception about whether a caller is
            speaking with an AI where disclosure is required, or any unlawful purpose.
          </p>
        </Section>

        <Section title="4. AI limitations">
          <p>
            The Service uses artificial intelligence. <strong>AI output can be wrong.</strong>{" "}
            Transcripts, summaries, extracted details, quality grades, and suggested knowledge may
            contain errors, and the receptionist may occasionally misunderstand a caller or give an
            answer you did not intend. The Service is not a substitute for professional, legal,
            medical, or emergency advice, and you agree not to rely on it as such. You are
            responsible for reviewing AI-suggested changes before approving them.
          </p>
        </Section>

        <Section title="5. Fees and trials">
          <p>
            Paid plans are billed monthly (or yearly) per business location. When you sign up and
            subscribe yourself, the first period is charged at checkout and there is no setup fee.
            A one-time setup fee applies only where we set the service up for you, and is shown at
            purchase before you pay. Every new account starts with a 21-day free trial: we do
            not ask for a card during it, it is never charged, and it does not become a paid plan
            unless you choose one — if you do nothing, it simply ends. We may also grant free access
            for a longer or unlimited period at our discretion. Fees are non-refundable except where required by law. You can cancel at any time and
            keep the service until the end of the period you have paid for. We may change pricing
            with at least 30 days&rsquo; notice, effective at your next billing cycle.
          </p>
        </Section>

        <Section title="6. Your data">
          <p>
            You own your business data and your call data (recordings, transcripts, messages,
            appointments). You grant us the licenses needed to operate the Service — to process,
            store, and transmit this data to the subprocessors listed in our{" "}
            <a href="/privacy" className="text-foreground underline underline-offset-2">
              Privacy Policy
            </a>
            . Our handling of personal information is described there. On termination you may
            export your leads and data before your account is closed; we may delete your data after
            a reasonable retention window.
          </p>
        </Section>

        <Section title="7. Availability and support">
          <p>
            We aim for high availability but the Service is provided &ldquo;as is&rdquo; and
            &ldquo;as available&rdquo; without uptime guarantees. Telephone networks, carriers, and
            the third-party providers we build on can fail in ways outside our control. Configure a
            forwarding number so calls can reach you if the Service is unavailable.
          </p>
        </Section>

        <Section title="8. Disclaimers and limitation of liability">
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED,
            INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE
            ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES,
            OR FOR LOST PROFITS, REVENUE, OR BUSINESS OPPORTUNITIES (INCLUDING MISSED CALLS OR
            BOOKINGS), EVEN IF ADVISED OF THE POSSIBILITY. OUR TOTAL LIABILITY FOR ANY CLAIM IS
            LIMITED TO THE FEES YOU PAID US IN THE TWELVE MONTHS BEFORE THE CLAIM AROSE.
          </p>
        </Section>

        <Section title="9. Indemnification">
          <p>
            You will defend and indemnify us against third-party claims arising from your use of
            the Service in violation of these terms or of law — including claims that you recorded
            calls, sent text messages, or contacted consumers without a legally required consent or
            disclosure, and claims arising from the goods or services your business provides to
            your own customers.
          </p>
        </Section>

        <Section title="10. Dispute resolution — binding arbitration and class-action waiver">
          <p>
            Before filing any claim, you agree to contact us and give us 30 days to resolve the
            dispute informally. If we can&rsquo;t, <strong>any dispute arising out of or relating
            to these terms or the Service will be resolved by binding individual arbitration</strong>{" "}
            administered by the American Arbitration Association under its Commercial Arbitration
            Rules, rather than in court — except that either party may bring an individual claim in
            small-claims court, or seek injunctive relief for infringement or misuse of
            intellectual property.{" "}
            <strong>
              You and we each waive the right to a jury trial and the right to participate in a
              class action, class arbitration, or other representative proceeding.
            </strong>{" "}
            Disputes may only be brought individually. You may opt out of this arbitration
            agreement by emailing us within 30 days of first accepting these terms; opting out does
            not affect any other provision.
          </p>
        </Section>

        <Section title="11. Termination">
          <p>
            You may cancel at any time from your account or by contacting us; cancellation takes
            effect at the end of the current billing period. We may suspend or terminate the
            Service for breach of these terms, non-payment, or use that risks harm to us, other
            customers, or the public, with notice where practicable.
          </p>
        </Section>

        <Section title="12. General">
          <p>
            These terms are governed by the laws of the State of California, excluding conflict of
            law rules. We may update these terms; material changes will be notified by email or
            in-product at least 14 days before taking effect, and continued use after that
            constitutes acceptance. If any provision is unenforceable, the rest remains in effect.
            Questions:{" "}
            <a
              href="mailto:arigberkowitz@gmail.com"
              className="text-foreground underline underline-offset-2"
            >
              arigberkowitz@gmail.com
            </a>
            .
          </p>
        </Section>
      </div>
    </article>
  );
}
