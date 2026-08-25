import type { Metadata } from "next";
import { env } from "@/lib/env";
import { SUPPORT_EMAIL, supportMailto } from "@/config/contact";

/**
 * One canonical policy, always. The app answers on both the production domain
 * and the old *.vercel.app deployment URL, and TCR rejects a brand whose
 * registration "points to multiple privacy policies" because reviewers can't
 * tell which one governs. The canonical link names the authoritative copy.
 */
export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: `${env.APP_URL.replace(/\/$/, "")}/privacy` },
};

const UPDATED = "August 18, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Privacy policy. NOTE FOR THE OPERATOR: starting draft, not legal advice —
 * lawyer review before selling; replace bracketed placeholders.
 */
export default function PrivacyPage() {
  return (
    <article className="space-y-10">
      <div className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Last updated {UPDATED}</p>
      </div>

      {/* Carrier/TCR vetters scan for this exact statement and reject the A2P
          campaign when they can't find it, or when it looks contradicted by the
          subprocessor list further down (error 30908). Keep it above the fold,
          verbatim, and keep §5 and §6 consistent with it. */}
      <div className="space-y-3 rounded-xl border border-foreground/15 bg-muted/40 p-5 text-[15px] leading-relaxed">
        <p className="font-semibold text-foreground">Mobile information and text messaging</p>
        <div className="text-muted-foreground [&_strong]:text-foreground">
          <p>
            <strong>
              We do not share, sell, or provide your mobile phone number or messaging consent data
              to third parties or affiliates for marketing or promotional purposes.
            </strong>
          </p>
          <p className="mt-2">
            <strong>
              No mobile information will be shared with third parties or affiliates for marketing or
              promotional purposes. Information sharing to subcontractors in support services, such
              as customer service, is permitted. All other use case categories exclude text
              messaging originator opt-in data and consent; this information will not be shared with
              any third parties.
            </strong>
          </p>
          <p className="mt-2">
            <strong>Message frequency varies.</strong> Message and data rates may apply. Reply STOP
            to opt out, HELP for help. This is the single, authoritative privacy policy for
            FrontDesk AI and the messaging program described below.
          </p>
        </div>
      </div>

      <div className="space-y-10 text-[15px] leading-relaxed text-muted-foreground [&_strong]:text-foreground">
        <Section title="1. Scope">
          <p>
            This policy explains how FrontDesk AI (Ari Berkowitz d/b/a FrontDesk AI — &ldquo;we&rdquo;,
            &ldquo;us&rdquo;) handles personal information when businesses use our AI phone
            receptionist (the &ldquo;Service&rdquo;) and when people call a business that uses it.
            It covers two groups: <strong>customers</strong> (the businesses with accounts) and{" "}
            <strong>callers</strong> (people who phone those businesses).
          </p>
        </Section>

        <Section title="2. Information we collect">
          <p>
            <strong>From customers:</strong> account details (name, email), business information
            (services, hours, address, phone numbers, website content you ask us to import),
            calendar connections you authorize, and billing details (handled by Stripe — we never
            store full card numbers).
          </p>
          <p>
            <strong>From callers:</strong> when someone calls a business using the Service, we
            process the phone number, <strong>the audio of the call (which may be recorded)</strong>
            , a transcript, and details the caller shares during the conversation — such as their
            name, callback number, the service they want, preferred times, and messages they leave.
            The business the caller dialed controls this data; we process it on that
            business&rsquo;s behalf.
          </p>
        </Section>

        <Section title="3. How we use it">
          <p>
            We use this information to operate the Service: answering and routing calls, booking
            appointments, capturing messages, notifying the business, and billing. We also use AI
            to process call content — generating transcripts and summaries, classifying what the
            caller wanted, grading how well the AI receptionist performed, and drafting suggested
            improvements and follow-up messages <strong>that a human at the business reviews and
            approves</strong>. We do not sell personal information, and we do not use call content
            to advertise to callers.
          </p>
        </Section>

        <Section title="4. Call recording">
          <p>
            Calls handled by the Service may be recorded and transcribed. The Service plays a
            disclosure at the start of calls where the business has enabled it; recording-consent
            laws vary by jurisdiction, and the business you called is responsible for its
            disclosure settings. If you are a caller and want a recording deleted, contact the
            business you called — or contact us and we will refer your request to them.
          </p>
        </Section>

        <Section title="5. Service providers (subprocessors)">
          <p>
            We rely on a small set of providers to run the Service, and share only what each needs:
            voice and telephony (Retell AI), AI language processing (Anthropic), text messaging
            (Twilio), email (Resend), payments (Stripe), authentication (Clerk), database and
            hosting (Neon, Vercel), and calendar scheduling (Google Calendar or Cal.com, when the
            business connects them). Each acts as our subcontractor in support of delivering the
            Service, is bound by its own data protection commitments, and may not use the data for
            its own marketing.
          </p>
          <p>
            <strong>
              This does not include mobile opt-in data. Text messaging originator opt-in data and
              consent are never shared with any third party or affiliate, including the
              subcontractors listed above, for marketing or promotional purposes.
            </strong>
          </p>
        </Section>

        <Section title="6. Text messaging (SMS) and mobile information">
          <p>
            <strong>What we collect for messaging:</strong> your mobile phone number, the fact that
            you consented on the call and when, and the appointment details needed to write the
            message (your name, the service, and the date and time). Nothing else is collected for
            the messaging program.
          </p>
          <p>
            <strong>How we use it:</strong> solely to send you the transactional messages you agreed
            to — an appointment confirmation, a reminder before the appointment, and any follow-up
            you specifically asked for. We do not use it for marketing, we do not sell it, and we do
            not use it to build advertising profiles.
          </p>
          <p>
            Callers who verbally agree on a call may receive appointment confirmations, reminders,
            and requested follow-up texts from the business they called.{" "}
            <strong>Message frequency varies</strong> — typically one to three messages per booking.{" "}
            <strong>Message and data rates may apply.</strong> Reply STOP to opt out or HELP for
            help. Consent to receive texts is not a condition of any purchase.
          </p>
          <p>
            <strong>
              No mobile information will be shared with third parties or affiliates for marketing or
              promotional purposes. Information sharing to subcontractors in support services, such
              as customer service, is permitted. All other use case categories exclude text
              messaging originator opt-in data and consent; this information will not be shared with
              any third parties.
            </strong>
          </p>
          <p>
            We do not sell mobile phone numbers or SMS consent data, and we do not use them for our
            own marketing. How consent is collected on the call is documented in full on our{" "}
            <a href="/sms-consent" className="text-foreground underline underline-offset-2">
              SMS Consent page
            </a>
            .
          </p>
        </Section>

        <Section title="7. Retention">
          <p>
            We keep call recordings, transcripts, and business data while the business&rsquo;s
            account is active. Once an account closes or is deleted, its remaining records —
            including call transcripts, leads, and appointment history — are deleted by an
            automated job after a 90-day grace period. Businesses can delete individual records
            (leads, knowledge, and so on) from their dashboard at any time; deleted records are
            removed from active systems promptly and from backups on a rolling basis.
          </p>
        </Section>

        <Section title="8. Google user data">
          <p>
            When a business connects its Google Calendar, the Service accesses calendar data for
            exactly two purposes: reading free/busy availability so the AI offers callers only
            genuinely open appointment times, and creating or removing calendar events when an
            appointment is booked or cancelled. FrontDesk AI&rsquo;s use and transfer of
            information received from Google APIs adheres to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. Google calendar data is never sold, never
            used for advertising, never used to train AI models, and never shared except as needed
            to provide scheduling for the business that connected it. Disconnecting the calendar in
            the dashboard revokes our access; stored credentials are deleted.
          </p>
        </Section>

        <Section title="9. Security">
          <p>
            Data is encrypted in transit, access is limited by role and tenant (a business can only
            ever see its own data), calendar credentials are stored encrypted, and webhooks are
            signature-verified. No system is perfectly secure; if a breach affects your personal
            information we will notify affected parties as required by law.
          </p>
        </Section>

        <Section title="10. Your rights">
          <p>
            Depending on where you live (for example under the CCPA or GDPR), you may have rights
            to access, correct, delete, or export personal information, and to object to certain
            processing. Customers can exercise these directly in the product or by contacting us.
            Callers should contact the business they called (the data controller); we support
            businesses in fulfilling these requests. We do not knowingly collect information from
            children under 13.
          </p>
        </Section>

        <Section title="11. Changes and contact">
          <p>
            We will post any changes to this policy here and notify customers of material changes
            by email or in-product. Questions or requests:{" "}
            <a href={supportMailto()} className="text-foreground underline underline-offset-2">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </Section>
      </div>
    </article>
  );
}
