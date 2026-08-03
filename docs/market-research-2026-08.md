# Where FrontDesk AI can actually win

Market research, August 2026. Four parallel research passes: horizontal competitors, vertical players, what users complain about, and pricing/integration access. Everything here is sourced; where a claim is vendor marketing rather than demonstrated, it says so.

---

## The short version

Three findings decide everything else.

**Voice quality is no longer a differentiator, and hasn't been for a while.** The dental category alone now contains dozens of near-identical vendors running the same speech stacks. None of them differentiate on how the agent sounds. They all differentiate on which system it writes to. Roughly 70–80% of the value in this category is integration depth; the remaining 20–30% is not "does it sound human" but vertical conversational logic — knowing which callers are worth money, which must be refused, and what artifact has to exist when the call ends.

**The price floor collapsed in mid-2026.** Zoom launched a standalone AI receptionist at $24.99–$29.99 per 100 minutes in July, deliberately telephony-agnostic so you don't have to switch phone systems. RingCentral cut to $39–$49 per 100 minutes in May and disclosed 11,800 businesses using it. Two public companies now bracket the bottom of this market with published, no-sales-call pricing. Any standalone product charging $99–$299 has to justify the delta on something other than existing.

**The SMB middle is being abandoned by the people who were in it.** Synthflow deleted its self-serve tiers and now publishes one number: enterprise contracts from $30,000/year. Numa repositioned entirely to car dealerships. Both had SMB products in 2025. Both left. That is the clearest available signal that undifferentiated horizontal SMB voice is not a business — you get squeezed from below by phone-system incumbents bundling it for $39, and from above by vertical players who own the write path.

---

## What the market looks like now

### Horizontal SMB (the crowded middle)

| Vendor | Price | Meter | Note |
|---|---|---|---|
| Zoom Virtual Agent Receptionist | $24.99–29.99 / 100 min | minutes | Works on any phone system. Launched July 2026 |
| RingCentral AIR | $39–49 / 100 min | minutes | 11,800 businesses. Owns the carrier layer |
| Rosie | $49 / $149 / $299 | minutes | Booking and transfer gated to $149. No published overage |
| Goodcall | $79 / $129 / $249 | **unique customers** | Explicitly unlimited minutes. $0.50/extra customer |
| Beside | $29.99/user (or $16.67 annual) | seats | $4M ARR, 20,000 customers, $32M raised |
| Dialzara | $29–$349 | minutes | Publishes overage on every tier ($0.35–0.48/min) |
| Smith.ai AI | Free / $150 / $500 | **per call** | ~$1.67–3.00/call. Has 500+ human receptionists behind it |
| Abby Connect AI | $99–$690 | minutes | Routes to live humans when the AI can't cope |
| Nextiva XBert | $99 / 100 conversations | conversations | Requires a Nextiva phone plan underneath |

### Vertical (where the money is)

| Vendor | Vertical | Price | Moat |
|---|---|---|---|
| Avoca | HVAC/plumbing | hidden ($1–3k/mo reported) | $1B valuation, 800 customers, ServiceTitan depth |
| ServiceTitan Contact Center Pro | field service | hidden | **Books against real dispatch capacity.** Owns the board |
| Jobber Receptionist | field service | $29/30 conversations, $0.79 over | Owns the calendar. Only vendor publishing conversation pricing |
| Slang.ai | restaurants | $399–599/location | 25M calls from 10M guests. $36M Series B |
| Loman | restaurants | ~$199/location | POS ordering + payment. Toast/Square/Clover native |
| Arini | dental | hidden (~$249–499 reported) | Open Dental + Dentrix + Eaglesoft + Curve |
| Peerlogic | dental | $399 / $699 | Agent gated to the $699 tier |
| Eve / EveOS | plaintiff law | hidden | **Sends the engagement letter for e-signature before the call ends.** 1,400 firms, >$1B |
| Assort Health | specialty medical | hidden | 62,000 care protocols, 1.6M decision pathways. $1.2B |

### What that table is actually saying

ServiceTitan advertises "book jobs based on your real capacity." Avoca — a billion-dollar company and a certified ServiceTitan partner — documents its own sync as batch incremental reads of customers, jobs, job types and invoices, with event-driven writes, and **does not document technician availability or dispatch capacity syncing at all**. An agent that cannot see the dispatch board is guessing at the schedule it books into. No amount of voice quality closes that gap.

Eve can send an engagement letter mid-call because Eve *is* the case management layer. Jobber can book because Jobber owns the calendar. That is a different kind of company from Arini and Avoca, which rent access to someone else's database and can be out-competed by anyone who pays the same license fee.

---

## What actually makes businesses cancel

From G2 verbatims, Hacker News, a Reddit archive, and two vendor-commissioned surveys. Ranked by frequency × lethality.

**1. Slot-capture failure with repeat-asking.** The single most-cited failure and the most expensive, because it kills the call and poisons the lead record.

> "I recently fired a plumber I was trying to contract for a five figure remodel job because his AI receptionist couldn't understand my address." — Hacker News, March 2026. The same commenter told the same story again seven months later.

Parloa's consumer study: **10% of callers abandon after being asked to repeat information once. 60% are gone by the second repeat.** Meanwhile these appear in *five-star* reviews: "At times the AI receptionist doesn't get the correct name or contact information of the caller."

**2. No working escape to a human.** Every other failure is survivable if the caller can get out.

> "I asked it to talk to a real person: a manager, legal, or compliance employee and it hung up on me."

53.6% of consumers actively try to circumvent the bot — 43.9% by saying "human" or "person," 34.8% by mashing zero, 17% with profanity. NextPhone's own marketing stat, across 1.4M calls, is that 73.8% of transfers route correctly. Inverted: **one in four transfers doesn't reach the right person**, published as a success metric.

**3. Billing uncorrelated with value.** The most common *stated* final straw, because it arrives once a month as a document with a number on it.

> "They billed us for spam calls... They billed us for time where the phone is ringing... They charged us overage when 70% of the minutes were spent on spam calls and the phone ringing." — Abby Connect, 0 stars, roofing contractor

And from a 2-star Smith.ai review: robocall volume spiked, and **support suggested moving to a higher tier to avoid the overage charges**. The vendor's answer to being billed for junk was to sell more.

Note the structural trap in per-minute pricing: the failure modes (repeat-asking, loops, spam) *increase* minutes. Bad performance costs the customer more money.

**4. Vendor operational failure.** Not an AI problem at all, but it produces the angriest reviews. Podium's 0-star reviews describe year-long auto-renewing contracts sold as "monthly," being sent to collections, losing the main business line for weeks, and $6,000 in unauthorized charges.

**5. Bookings that are wrong in physical-world ways.** Same roofing review: appointments booked in the wrong timezone, and **roof estimates booked without the customer's address**. A truck roll that cannot happen.

**6. Hallucinated prices, hours, and promises.** "The AI said my car would absolutely be done today." One developer building this for his brother's shop names the risk precisely: quote $200 for brakes when the answer is $450, and you own the difference.

**7–8. Turn-taking and noise.** High frequency, low individual severity, erodes rather than kills. Concentrated in exactly the industries buying hardest — trades customers call from job sites and trucks.

**9. Brand mismatch.** "If my mechanic answered with an LLM I'd take my car elsewhere."

**10. Emergency mishandling.** Almost no documented complaints — which is the point. A missed "no heat, infant in the house" doesn't become a G2 review. It becomes a phone call to a lawyer. Assume this is under-reported by an order of magnitude.

### What callers think, which is worse than businesses realize

> "If someone puts me on with a voice AI I'm never talking to them again."
> "AI receptionists make me want to never deal with the company again."
> "It has an odd uncanny valley feeling to it that I simply don't trust."
> "What else is he willing to do to save a few bucks?"

AnswerConnect's April 2026 survey of 6,000 consumers: 85% prefer a human (up from 83% six months earlier), **31% would hang up if connected to AI** (up from 29%), 86% say companies should disclose AI use. That survey is from a company selling human answering services, so discount it — but Parloa, which sells *AI* agents, found 25.9% name "talking to a bot that doesn't understand me" as their top pain point and only 13.6% fully trust AI with complex requests.

The direction of travel matters more than the absolute numbers: consumer tolerance is going **down**, not up, as exposure increases.

### The measurement problem nobody is solving

NextPhone publishes, from 1.4 million calls, that **99.0% of callers express positive or neutral sentiment**. That score is produced by the same class of model that ran the call. Set it against 43.9% of consumers yelling "human" and a restaurant operator finding customers "cursing at the chatbot" in his own call logs, and the number is not credible.

Nobody in the SMB tier publishes latency — the metric that most determines whether a call feels human. Only the developer platforms do (Bland 400ms, Vapi <500ms, Retell ~600ms).

Nobody separates "handled" from "resolved." Hang-ups in the first 15 seconds, transfers attempted but not connected, and calls ending with zero captured contact info all roll up into "calls answered."

---

## Legal exposure the market is sleepwalking into

**A correction worth knowing:** many vendor blogs claim California requires phone bots to disclose. **It doesn't.** Cal. Bus. & Prof. Code § 17941 covers bots operating *online* — public-facing websites and web applications. A voice call is not covered, and AB 410 kept that scoping.

What does reach an inbound AI receptionist:

- **Utah AI Policy Act** — must disclose on a clear request that the caller is talking to AI; **proactive disclosure is required in regulated occupations regardless of request**, which covers dental, medical and legal. Up to $2,500/violation.
- **Maine LD 1727** (effective Sept 2025) — disclosure where the design could make a reasonable consumer think a person is on the other end. Violations are Unfair Trade Practices Act violations.
- **Colorado SB 24-205** — up to $20,000/violation, compliance date currently unsettled.

**The sleeper risk is call recording, not disclosure.** *Galanter v. Cresta Intelligence* alleges an AI vendor recorded, transcribed and analyzed calls using NLP without disclosing a third party was involved — seeking $5,000 per call under two CIPA provisions. The standard AI receptionist architecture is third-party ASR, third-party LLM, third-party TTS, transcripts retained for "improvement." That is precisely the fact pattern. And the small business, not the vendor, is the one the caller's lawyer names first.

Meanwhile businesses are publicly bragging about the opposite. A five-star Trustpilot review, from a Washington State construction company: *"Today my client don't even know they speaking with ai agent."*

TCPA: inbound is fine — the customer called you. Exposure begins the moment you do callbacks, reminders, or reactivation campaigns without documented consent. $500/call, $1,500 willful, uncapped.

---

## What integrations actually cost to get

| System | Barrier | Cost |
|---|---|---|
| Google Calendar, Microsoft 365, Calendly, Cal.com, Square, Zapier | none | free |
| **Clio (Manage + Grow)** | security review, self-serve docs | **free** |
| MyCase, PracticePanther, Lawmatics | partner APIs | low |
| Housecall Pro | public API, public docs | free |
| Jobber | public GraphQL API | free (but Jobber sells a competing receptionist) |
| Open Dental | email for a developer key; eConnector on the practice server; BAA per client | tiered, modest |
| Vagaro | 5-day review; customer must have Vagaro payments | $10/mo |
| **Dentrix** | developer program, discretionary approval | **$5,000 per API** + $47/location/mo on Ascend |
| Boulevard, Mindbody | no public program; relationship-gated | unpublished |
| **ServiceTitan** | competitive approval, security eval, **annual re-certification** | dues + per-tenant fee or rev share |
| **Toast** | legal/security/privacy review, alpha and beta in live restaurants | **3–6 months** |
| OpenTable | at-will termination without notice, re-approval on any material change | hostile terms |
| Resy | no third-party path exists | unavailable |

**The sequencing consequence.** A new entrant can be fully credible in **legal** and **small-end home services** on public APIs alone, for essentially zero integration cost. Dental costs ~$10,000 up front plus per-location fees. Restaurants cost 3–6 months of calendar time you cannot buy your way out of. Salons require a business-development motion at Boulevard.

---

## Underserved verticals

**Salons, spas, personal care — the clearest gap.** Every search returns horizontal vendors with a vertical landing page. No funded, PMS-native player. Boulevard, Vagaro, Mindbody and Zenoti have not shipped serious voice products the way ServiceTitan, Jobber, Weave and Dental Intelligence all did in 2025–26. And salon booking is genuinely *harder* than dental: duration varies by stylist and service, resources are stylist-and-chair constrained, add-ons change duration mid-booking, no-shows demand deposits. Why nobody's done it: average ticket is $60–150 against a $30–40k HVAC install, so you need volume plus deposit capture to make the math work. Notably, Google's "Ask for Me" launched targeting nail salons — Google found the same gap.

**Restaurants above the reservation layer.** Slang has 2,000 locations and does reservations only. Most US restaurants aren't reservation restaurants — they're takeout-driven independents where the phone order *is* the revenue. Toast, Square and Clover haven't shipped native voice ordering.

**Legal outside plaintiff PI.** Eve is explicitly a plaintiff-firm product — personal injury and employment. Immigration, family, criminal defense and estate planning have no equivalent, despite high-volume, high-anxiety, frequently non-English inbound with real intake structure. Clio's App Directory listing two AI intake apps at $299 and $500/mo is the market telling you nobody has built the deep one.

**Saturated, do not enter:** dental, HVAC/plumbing, auto dealerships, specialty medical.

---

## One structural shift worth planning around

Google's "Ask for Me" places calls to businesses *on the consumer's behalf* — AI-disclosed, Duplex-based, launched on auto shops and nail salons and reportedly expanding into home repair, beauty and pet care. A growing share of inbound calls will be placed by an AI acting for a customer.

To that caller, voicemail reads as "did not answer." A hold queue reads as a hang-up. This converts an AI receptionist from a labor-cost saving into a **demand-capture requirement**, and it advantages whoever can answer instantly and return structured pricing and availability — an integration property, not a voice property.

---

## Where FrontDesk AI already stands

Worth being specific, because several of these are things the research says nobody else does.

**Already built, and genuinely differentiated:**

- **Quiet-line detection.** The forwarding-lapse cron notices when a business's calls stop arriving and tells them. The complaints research independently listed "carrier-vs-platform reconciliation" as a thing vendors should do and don't — it's the only way "we are not receiving phone calls from our customers" gets caught by the vendor instead of by the customer weeks later. This already exists here.
- **Honest revenue accounting.** Earned versus booked-ahead, valued at real service prices, recognized only after the appointment happens. Against a market where a vendor publishes 99% positive sentiment scored by its own model, this is a positioning asset, not just correctness.
- **Rates that go null instead of 100% on zero calls.**
- **Booking that refuses.** Closed days, blocked windows, appointments that don't fit before closing, per-person leave. The roofing contractor's cancellation was caused by exactly the class of bug this prevents.
- **Ambiguous service names produce a question, not a guess.** Directly addresses "booked the wrong service."
- **Atomic slot reservation** under a per-client advisory lock — no double-booking race.
- **SMS consent captured as its own question, STOP honored at the platform level.**

**Missing, and each maps to a ranked cancellation cause:**

| Gap | Maps to |
|---|---|
| No repeat-request counter or escalation on the second re-ask | Cancellation cause #1 |
| No escape-intent detection ("human", "person", keypad 0, profanity) | Cause #2 |
| No spam/ring-time waste telemetry | Cause #3 |
| No booking sanity checks (address required for on-site, timezone, duplicates) | Cause #5 |
| No unsourced-claim guard on prices, hours, turnaround | Cause #6 |
| No latency measurement | Causes #7 |
| No emergency keyword layer evaluated before intent | Cause #10 |
| No per-call AI-disclosure assertion stored | Utah/Maine exposure |
| No documented recording-consent posture | CIPA/Cresta exposure |
| No handled-vs-resolved metrics | The measurement problem |
| No Clio/MyCase integration | Credibility in legal — and the first customer is a law firm |

---

## Recommendations, ranked

### 1. Build the in-call safety net. Cheapest work, biggest churn impact.

Every one of the top failure modes is detectable inside the call with signals the platform already has. In every documented case, a human found it first.

- **Repeat-request counter.** Same slot re-asked twice → escalate or switch modality. Never a third time. Justified directly by Parloa's 10%/60% abandonment curve.
- **Escape-intent detection.** "human", "person", "representative", "real person", keypad 0, profanity → immediate transfer *and* an incident flag. Treat as a P1 event, not a conversational branch.
- **Low-confidence proper nouns** — don't retry the same way. Spell-back, keypad entry, or "I'll text you a link." Mark the record `unverified` so nobody calls a wrong number believing it's right.
- **Emergency keyword layer evaluated before intent classification.** "no heat", "gas smell", "flooding", "chest pain", "locked out", "child in the car" → page a human with delivery confirmation, never a booking flow. Fail closed.
- **Unsourced-claim guard.** Any price, hour, availability or turnaround not traceable to a retrieved document gets blocked or hedged, and logged. If the AI says it, the business owns it.
- **Booking sanity checks before commit.** Required fields by job type — an on-site estimate cannot exist without an address. Timezone consistency. Slot inside hours. Duplicate detection. Read back the address and time, then SMS the captured fields.

### 2. Make honest measurement the product, not a footnote.

This is the position nobody else can take without admitting their current numbers are marketing. The groundwork is already laid.

- Separate **handled** from **resolved**. Alert on: hang-ups in the first 15 seconds, hang-ups before any slot was filled, transfers attempted but not connected, calls ending with zero contact info.
- **Waste-aware billing telemetry.** Show minutes spent on calls that produced no lead, no booking, no message — and credit them by default. The #3 cancellation cause becomes a retention event: "you spent $340 on robocalls last month, here's a credit and a blocklist."
- **Human-audited sentiment sampling.** Pull a stratified weekly sample and have a person score it. Publish the negative tail with recordings attached. Never report a model's opinion of its own work.
- **Publish latency.** Nobody in the SMB tier does. It is the metric that determines whether the call feels human, and it is measurable today.

### 3. Turn compliance into a feature before it becomes a lawsuit.

- **Store a per-call compliance assertion**: the AI disclosed it was an AI, answered honestly when asked, gave the recording notice. Cheap to build, and it is the difference between a defensible record and the Cresta fact pattern.
- **Write an actual recording-consent posture** and tell customers what it is. Jobber is the only vendor with a written position, and theirs pushes the obligation onto the customer.
- **Get a BAA and SOC 2 on the roadmap** if medical or dental is ever a target. No SMB-native receptionist vendor is fully certified — that's a live exposure for all of them and an opening for one.

### 4. Pick legal, and go deep, because the first customer is already there.

The evidence points one way: legal is credible on **free** public APIs (Clio Manage, Clio Grow, MyCase), Eve has explicitly taken only plaintiff PI, and Clio's own directory shows the deep app hasn't been built. Ruby, PATLive and Goodcall are Zapier-only in legal — a visible, exploitable weakness.

Concretely: native Clio Grow lead creation, matter-type-aware intake, and the conservative conflict-check pattern (collect party names early, flag the record `conflict-check pending`, stop the caller before they disclose privileged information — the order of questions is an ethics problem a general receptionist doesn't know about).

### 5. Price against the meter everyone hates.

Per-minute billing means the agent is financially rewarded for talking longer, and the failure modes increase minutes. Buyers are starting to name this. Goodcall's unique-customer meter is the most defensible design in the market for exactly this reason: it sells the thing buyers hate paying for as unlimited, and meters a proxy that correlates with value rather than cost.

With Zoom at $24.99 and RingCentral at $39, competing on price per minute is a losing game. Competing on *what the meter measures* is not.

---

## Sources

Vendor pricing pages fetched August 2026: Goodcall, Rosie, Beside, Dialzara, My AI Front Desk, Smith.ai, Abby Connect, Ruby, PATLive, Slang.ai, Loman, Peerlogic, Viva, Jobber, NextPhone, Retell, Vapi, Bland, Synthflow, PolyAI, Zoom, RingCentral, Nextiva, Quo, Dialpad.

Reviews and forums: G2 (Smith.ai, Slang.ai, Ruby, AnswerConnect, Abby Connect, Podium, My AI Front Desk, Upfirst, Retell, Numa), Hacker News, Reddit via PullPush archive, Trustpilot.

Surveys: AnswerConnect/OnePoll (6,000 consumers, April 2026); Parloa Consumer Patience Index (1,001 US adults).

Legal: Cal. B&P Code § 17941; CA AB 410; Utah SB 149/SB 226; Maine LD 1727; Colorado SB 24-205; *Galanter v. Cresta Intelligence*; FCC February 2024 declaratory ruling; FTC v. Air AI settlement, March 2026.

Integration terms: Open Dental API specification, Dentrix Developer Program FAQ, ServiceTitan App Marketplace Program Guide, Toast integration dev guide, OpenTable API partner terms, Clio developer security guidelines, Housecall Pro public API docs, Vagaro API setup.

Funding and traction: Avoca ($125M, $1B valuation, April 2026), Eve ($103M Series B, >$1B), Assort Health ($120M Series C, $1.2B), Slang.ai ($36M Series B), Beside ($32M), Pie ($23.7M), Lassie ($35M), Weave Q1 FY2026 earnings call.
