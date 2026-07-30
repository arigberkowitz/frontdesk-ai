# Google OAuth verification — status and what's left

**Goal:** remove the "Google hasn't verified this app" screen that every business owner
currently sees when connecting Google Calendar.

## Done ✅
- Custom domain **frontdeskai.company** live, `APP_URL` set, app re-provisioned against it.
- OAuth client redirect URI added: `https://frontdeskai.company/api/calendar/google/callback`
  (the old vercel.app URI is kept so nothing breaks mid-migration).
- Branding page: app name, support email, home page, privacy + terms URLs all on the new
  domain; `frontdeskai.company` added as an authorized domain.
- **Search Console ownership verified** (TXT record on the apex domain, via Vercel DNS).
  Don't delete that record — removing it silently un-verifies the domain.
- Publishing status moved from *Testing* → **In production**, so any Google account can
  connect today (with the unverified-app warning until review completes).
- Sensitive scope `https://www.googleapis.com/auth/calendar` declared under Data Access,
  with the written justification saved (879/1000 chars).
- In-app guidance shipped: the Google tile in the portal tells owners exactly what the
  warning screen looks like and which link to click, so it stops costing conversions.

## Left to do 🎬
**One thing: the demo video.** Google requires an unlisted/public YouTube link showing the
scope in real use. Then hit Submit in the Verification Center.

### Recording script (~90 seconds, no narration needed)
Record the whole screen (QuickTime → File → New Screen Recording), **URL bar visible the
whole time** — reviewers check the domain and client ID.

1. Start at `https://frontdeskai.company` — let the landing page sit for 2 seconds.
2. Sign in and go to **Appointments** in the portal.
3. Click the **Google Calendar** tile, then **Continue to Google**.
4. Pick a Google account. **Let the "Google hasn't verified this app" screen appear and
   stay on screen ~3 seconds** — Google explicitly requires this to be visible. Then click
   *Advanced* → *Go to FrontDesk AI (unsafe)*.
5. **Pause on the consent screen** for ~3 seconds so the requested calendar permission and
   the app name are clearly legible. Click **Allow**.
6. Land back in the portal — show the green "Google Calendar connected" state.
7. Open Google Calendar in a new tab and show a booking that the AI created (or create one
   from the portal's "New appointment" and show it appear).

Upload to YouTube as **Unlisted**, copy the link.

### Then submit
Google Cloud Console → **Google Auth Platform → Data Access** → paste the link in
*Demo video* → **Save** → then **Verification Center → Submit for verification**.

Reply to any reviewer email quickly; each round trip adds days. Typical review for a
sensitive-only scope (no CASA audit needed): a few days to ~4 weeks.

## While waiting
Nothing is blocked — owners can connect today by clicking through the warning, and
Outlook / Cal.com have no warning at all. The 100-user cap on unverified sensitive scopes
applies over the app's lifetime, so verification matters well before 100 businesses.
