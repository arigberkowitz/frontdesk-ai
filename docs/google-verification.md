# Google OAuth verification — getting calendar connect open to everyone

**Why:** the OAuth consent screen is in *Testing* mode. Only listed test users can connect
Google Calendar; everyone else sees "Access blocked". Publishing + verification removes that
wall. The `https://www.googleapis.com/auth/calendar` scope is **sensitive**, so Google review
is mandatory (typically 1–4 weeks; no CASA security audit needed for sensitive-only scopes).

## Before you submit
1. **Console** (console.cloud.google.com → APIs & Services → OAuth consent screen):
   - App name: FrontDesk AI · support email: your address
   - App domain: https://frontdesk-ai-alpha.vercel.app (move to a custom domain first if you
     plan to — verification is per-domain, and re-verifying later is a second review)
   - **Privacy policy**: https://frontdesk-ai-alpha.vercel.app/privacy (already public ✓)
   - **Terms**: https://frontdesk-ai-alpha.vercel.app/terms (already public ✓)
   - Authorized domain: verify ownership in Search Console (vercel.app subdomains can't be
     verified as yours — this is the strongest argument for a custom domain before submitting)
2. **Scope justification** (you'll paste this in the form): "FrontDesk AI is an AI phone
   receptionist for small businesses. With the user's consent it reads free/busy times to
   offer open slots to callers, and creates/cancels calendar events when a caller books or
   cancels an appointment. Events may include a Google Meet link for video-friendly services."
3. **Demo video** (unlisted YouTube): screen-record the full flow — portal → Appointments →
   Connect Google Calendar → consent screen (URL bar visible, showing your client ID) →
   grant → a booking appearing on the calendar. 2–3 minutes, no narration needed.

## Submit
OAuth consent screen → **Publish app** → **Prepare for verification** → fill the form with
the links + video → submit. Answer reviewer emails quickly; each round-trip costs days.

## Until it's approved
Test users (max 100) keep working: OAuth consent screen → Test users → Add. Personal Gmail
addresses only — Workspace accounts under org policies can still be blocked by their admins
regardless of verification.
