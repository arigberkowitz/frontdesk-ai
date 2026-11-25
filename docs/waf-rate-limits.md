# Proposed Vercel WAF rate limits

These rules are **not applied**. Creating, editing, or publishing Firewall
rules is a dashboard change and needs explicit approval. This file is the
exact proposal to approve or edit.

The app also has a fail-open code hook (`src/lib/waf-rate-limit.ts`,
`checkRateLimit` from `@vercel/firewall`) so a missing rule never blocks
traffic. The hook only starts enforcing after a rule with the matching
Rate limit ID is published.

`vercel.json` cannot express a `rate_limit` action (only `deny` and
`challenge`), so rules cannot live in that file.

## Plan and cost (as of Nov 2026)

- Rate limiting is available on all plans. Hobby: 1 rate-limit rule per
  project (inside a total of 3 custom rules). Pro: 40 custom rules.
  Enterprise: 250.
- Counting keys on Hobby/Pro: IP or JA4. Fixed window only. Window is
  10 seconds–10 minutes (Enterprise can go to 1 hour).
- First 1,000,000 **allowed** requests per month are included (May 2025
  changelog). After that, Pro is billed regionally starting at $0.50 per
  1 million allowed requests. Blocked/challenged/rate-limited traffic
  does not incur CDN requests or Fast Data Transfer.
- Counters are **per region**, so traffic hitting several regions can
  exceed the configured number by about that many times.
- This project is on the `arigberkowitzs-projects` team, which is
  typically Pro — not verified here (the Vercel token cannot read that
  team). If it were Hobby, only one rate-limit rule would be allowed;
  in that case use a single combined path rule instead of the set below.

Only match the costly POST paths below. A broad `/api` or site-wide rule
would burn the 1M included "allowed" requests on ordinary traffic.

## Do not rate-limit these by IP

- `/api/webhooks/*` — Twilio, Stripe, Retell, and toll-free event
  streams. Signature-verified; many events share a small set of
  provider IPs.
- `/api/agent-tools/*` — Retell and our own chat route call these from
  shared infrastructure IPs. Token + signature auth already required.
- `/api/cron/*` — Vercel Cron with `Authorization: Bearer $CRON_SECRET`.

## Rollout

1. Create the rules with Then-action **Log** (blocks nothing).
2. Review Firewall traffic for a day or two.
3. Switch Then-action to **Too Many Requests (429)** and publish.

## A. Edge path rules (primary — stop floods before the function runs)

Fixed window, count by **IP**, follow-up action **429** after the log
period. Method must be **POST**.

| Name | If (all must match) | Limit | Why |
| --- | --- | --- | --- |
| Public web chat | Method = POST AND Path = `/api/chat` | 20 requests / 10 minutes / IP | Public LLM receptionist. App already aims for 20/10 min, but that limiter is in-memory per warm instance and is not reliable on serverless. Durable Postgres caps still apply per business (300 turns/day) and for chat-triggered SMS. |
| Contact form | Method = POST AND Path = `/contact` | 8 requests / 10 minutes / IP | Public "ask for a trial" form. App limiter is 5/hour/IP in memory. WAF max window on Pro is 10 minutes, so 8/10 min is the edge backstop. |
| Intake form | Method = POST AND Path starts with `/intake` | 8 requests / 10 minutes / IP | Public signed-link form; a submit can run a paid website scrape. App limiter is 6/hour per link, in memory. |
| Sign-up | Method = POST AND Path starts with `/sign-up` | 20 requests / 10 minutes / IP | Clerk-hosted sign-up. No app-level limiter. 20 is generous so Clerk's own multi-step POSTs still work. |
| Sign-in | Method = POST AND Path starts with `/sign-in` | 30 requests / 10 minutes / IP | Credential stuffing backstop. Keep this looser than sign-up so a typo-and-retry still works. |
| Welcome setup | Method = POST AND Path = `/welcome` | 5 requests / 10 minutes / IP | Authenticated self-serve onboarding: website scrape + receptionist provision. One account can only create one business, but many accounts from one IP should not scrape for free. |
| Browser test call | Method = POST AND Path matches `/api/clients/.+/test-call` | 3 requests / 10 minutes / IP | Signed-in Retell web call. No app-level limiter today. Each click costs minutes. |

There is **no public HTTP demo-call trigger**. The marketing "demo" is a
canned transcript; the live sales demo is a phone number
(`DEMO_PHONE_NUMBER`), not an API. The closest HTTP equivalent of
"3 demo calls per IP per 10 minutes" is the browser test-call rule
above.

Waitlist and SMS send have no public unauthenticated HTTP endpoints.
Waitlist is a signed agent-tool (and a chat tool). Chat-triggered SMS
already has durable Postgres caps (3/phone/day, 40/business/day).

## B. SDK rules (needed for the code hooks to enforce)

Same limits as above, but the If condition is **`@vercel/firewall`**
with the Rate limit ID exactly as written. Counting key can stay IP;
the code may pass a more specific `rateLimitKey` (intake link, user,
client). Then-action: Log first, then 429.

| Rule name | Rate limit ID (must match code) | Suggested limit |
| --- | --- | --- |
| SDK public chat | `public-chat` | 20 / 10 min |
| SDK contact form | `public-contact` | 8 / 10 min |
| SDK intake form | `public-intake` | 8 / 10 min |
| SDK browser test call | `owner-test-call` | 3 / 10 min |
| SDK call me now | `owner-call-me` | 3 / 10 min |
| SDK welcome setup | `signup-onboard` | 5 / 10 min |

`owner-call-me` has no reliable edge path (the server action POSTs to
whichever portal page the button is on), so the SDK rule is the one
that covers it. The action already has a 3/10 min in-memory cap per
business.

## Dashboard steps

For each edge rule: Project → Firewall → Configure → New Rule → name it
→ add the If conditions → Then = Rate Limit → Fixed Window → set the
window and request limit → key = IP → Then = Log (first) or 429 → Save
Rule. **Do not click Publish until approved.**

For each SDK rule: same, but the If condition is `@vercel/firewall` and
the Rate limit ID is the string in the table.

CLI equivalent (still only stages a draft; publish is a separate
approval):

```bash
vercel firewall rules add "Public web chat" \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --condition '{"type":"path","op":"eq","value":"/api/chat"}' \
  --action rate_limit \
  --rate-limit-window 600 \
  --rate-limit-requests 20 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes
```

Review with `vercel firewall diff` before anyone publishes.
