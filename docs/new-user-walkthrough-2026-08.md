# Walking FrontDesk AI as a brand-new user

August 6, 2026. Everything below is anchored to code, to production data, or to
the two real calls from the evening of August 5.

Three patches have already been applied for the items marked **DONE**. The rest
are listed with what they cost you if left alone.

---

## The one that matters most

**A business that signs up today cannot turn its receptionist on.**

`createClient` gives a new business `status: "draft"` and no subscription.
`clientMayActivate` returns true only for `trial`/`live` status or an active
Stripe subscription, so it is false for every self-serve signup. The "Your AI"
page therefore shows a trial-code box instead of the activate button, and the
action itself refuses with *"Activation unlocks with a plan or an approved free
trial."*

There is no plan path in the portal either — `startCheckoutAction` calls
`requireOperator()`, so a business owner can never reach checkout for any of the
four plans on the pricing page. The only unlock is a six-character code you
generate by hand and deliver out of band, then approve by hand.

Meanwhile the landing page says **"Get started free"** three times, **"A 14-day
free trial — no charge until you go live"**, and **"most businesses are live the
same afternoon."**

So the funnel is: sign up from "Get started free" → build the whole receptionist
→ click "Activate" → be asked for a code nobody gave them → wait for a human.

Two honest ways out. Either build self-serve trial and checkout, or change the
landing page to "Request access" / "Book a demo" and treat the prices as
guidance. Doing neither is the most expensive thing on this list, because
everything else here only matters to people who got past this.

---

## ADD

1. **Self-serve activation** — see above.

2. **A consent record.** The privacy policy says you store *"the fact that you
   consented on the call and when."* You don't. `sms_consent` is a tool argument
   that decides whether to send and is then discarded — no column on
   `appointments`, `leads`, or anywhere. When a TCPA complaint arrives you have
   no proof of consent. One row: phone, timestamp, the wording used, the call id.

3. **A Twilio status callback.** Today a message Twilio *accepts* is recorded as
   "sent". Carrier-level failures after that (30032, 30007, and so on) never come
   back, so the owner is told a text was delivered that wasn't.

4. **A retention job.** Privacy §7 says records *"are deleted or de-identified"*
   and that deleted records are *"removed from active systems promptly."* Every
   delete in the schema is a soft delete. A "deleted" call keeps its recording
   URL, transcript, and full raw payload indefinitely. There is no purge cron.
   Either write one or rewrite §7.

5. **Starter packs for the other five industries.** The dropdown offers eleven;
   six have packs. HVAC, Veterinary, Chiropractic, Fitness and Other fall to a
   generic pack right after the form promises *"real services, hours, and FAQs
   for your industry."* An HVAC company gets "Standard appointment $120" and the
   guardrail *"never give medical, legal, or financial advice"* — while the
   gas-leak-and-911 rules written for exactly that business sit in the Home
   services pack it wasn't shown. A vet gets no medical guardrail at all.

6. **Rate limiting and length caps on the intake form.** The token is a 30-day
   multi-use bearer with no throttle. Each submit with a website triggers a live
   scrape plus three Anthropic calls, and *appends* services and FAQs rather than
   replacing them — so repeat submits duplicate the catalogue. The free-text
   `instructions` field lands in `agentGuidance`, which the prompt injects as
   "follow this exactly, highest priority" into the live phone agent.

7. **Owner notification when a keyword arrives with extra words.** "Cancel my 2pm
   please" is matched as STOP: the customer is opted out, gets no
   acknowledgement, the owner is never told, and the appointment stays on the
   calendar. "Info about parking?" hits HELP the same way. Keep the carrier
   behaviour, but tell the business a human said something.

8. **A pre-activation Overview.** A business that isn't live sees "Your AI
   receptionist — here's what it caught for you" over Revenue $0, Calls 0,
   After-hours saves 0. It reads like a product that isn't working rather than
   one that hasn't started.

9. **Confirmation on deleting time off.** It's the only destructive action
   without one, and removing a holiday closure re-opens those hours to the AI
   immediately.

10. **Error feedback on the alert-roster add form.** It's a plain form with no
    action state, so a rejected entry just… doesn't appear. No toast, no field
    error, no explanation.

**DONE in patch 3:** the website-scrape fallback, the honest onboarding banner,
"Activate" requiring a phone number, forwarding's "I've done this" only existing
once there's a number, the skipped-calendar note, and phone validation on the
alert roster and team members.

---

## FIX

11. **Your Twilio credentials in Vercel.** Production is getting HTTP 401 on
    every send. Every confirmation, reminder and follow-up has been failing.
    *This one is yours — re-paste `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`
    and redeploy.*

12. **One Twilio number for every tenant.** `/sms-consent` tells carriers
    *"consent is collected per business — opting in with one business does not
    opt you in with any other."* Both halves are untrue: one number texts on
    behalf of everyone, and the opt-out list is global (the schema comment says
    so). Worse, replies are dropped entirely — the handler looks up the
    recipient by matching the `To` number against each client's *Retell voice*
    number, and outbound texts go from the shared number, so no reply ever
    matches. The owner is never told, and the recovery agent keeps texting
    someone who already answered. Per-client sender, or rewrite the policy.

13. **Stripe charges the setup fee on day one.** The checkout session has no
    `trial_period_days` and includes the setup fee as a line item, so anyone put
    through pays up to $2,100 immediately — while the page says "no charge until
    you go live" and the Terms say "we will not charge you before your trial
    ends."

14. **Sign-in.** It's unreadable in dark mode — a white radial gradient painted
    over `text-foreground`, so near-white headings on a white wash. It also
    creates accounts (there's a "Create your company's account" path) without
    ever showing Terms or Privacy, which undercuts the arbitration clause those
    Terms rely on.

15. **"Calls answered" doesn't add up.** The tile subtracts a count of
    *appointments* from a count of *calls*. Add three walk-ins and take one FAQ
    call and it reads "Calls answered 1" over a breakdown claiming three
    bookings. `m.outcomes` already holds the right numbers.

16. **"Revenue captured" shows a false equation.** It renders
    `bookings × avg price = total`, but `bookings` counts all non-cancelled
    appointments including future ones while the total sums actual prices of past
    ones only. The two sides essentially never match, and the label calls it
    "estimated" when the code deliberately makes it earned.

17. **Zod internals in the service form.** Clearing the duration box shows
    *"Too small: expected number to be >=5"*.

18. **JSON-LD advertises `price: "149"`** with no billing period and no setup
    fee, for a product whose real entry cost is $1,050+.

19. **The ☎ in the OpenGraph image** is rendered under a font with no dingbat
    coverage, so the brand chip is probably blank in every link preview.

20. **robots.ts and sitemap.ts fall back to the vercel.app host** instead of the
    validated `env.APP_URL` the legal pages use — the "multiple policies" split
    TCR rejects brands for.

**DONE in patches 1–3:** the transfer itself (four separate bugs), SMS error
reporting, failed sends no longer showing as "Last texted", hours that close
before they open, "Saved" toasts hiding a failed sync, the intake form erasing
the escalation number, recovery texts missing the opt-out line, and the crawler
identifying itself with a domain you don't own.

---

## CHANGE

21. **The hours page says hours only flag after-hours calls** — "*the AI answers
    24/7 regardless*". They're the booking window. Someone trimming their hours
    to tidy up a metric will quietly turn off booking.

22. **Three revenue numbers, three windows, no labels.** "Revenue captured"
    (all-time) sits directly above "last 30 days — $X earned" and "This week ·
    Booked value."

23. **The Spanish claim.** "Switches to fluent Spanish the second a caller
    speaks it" appears three times on the landing page. `languages` defaults to
    `"en"`, onboarding never asks, and the Retell agent is created with
    `language: "en-US"` unconditionally — even for someone who finds the
    Settings toggle, which only changes prompt text. Either wire it or drop it.

24. **"Unlimited minutes" on the Scale plan.** It implies caps on the others.
    Those caps appear on no public page, and `includedMinutes` is never read
    anywhere in the codebase. You're selling an upsell against a limit that is
    neither published nor enforced.

25. **The HELP reply.** "This number sends appointment reminders and follow-ups
    on behalf of local businesses. Reply STOP to opt out." No brand name, no
    contact, no "Msg&data rates may apply" — all three are standard 10DLC audit
    items. `/sms-consent` also tells people to *"contact the business directly at
    the number shown in the message"*, and there's no number in it.

26. **The website field rejects `brightsmile.com`.** It's `type="url"` plus a
    zod `.url()`, so the most likely thing a non-technical owner types triggers a
    browser tooltip. Normalise a bare domain to `https://`.

27. **The industry dropdown** should list only what has a pack, until (5) lands.

---

## DELETE

28. **`public/next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`** —
    create-next-app scaffolding, still publicly served.

29. **The "Unlimited minutes" bullet**, unless you enforce the caps.

---

## What was already right

Worth saying, because it's most of the product. Empty states on calls, leads,
appointments, services and knowledge are intentional and directional. The ROI
panel refuses to claim "your AI is on the job" at zero calls. Call health and
milestones render nothing rather than a wall of zeros. Deletes elsewhere are
soft and confirmed. `cancelAppointmentAction` and the reminder paths are
unusually honest about partial failure. The SSRF defences on the scraper are
solid, and the expired-intake-token path degrades cleanly. There is no
lorem-ipsum, no TODO, and no "coming soon" anywhere in the app.

The consent sentence on `/sms-consent` matches the sentence the agent actually
speaks, word for word. That's the hardest link in the chain to get right and
it's right.
