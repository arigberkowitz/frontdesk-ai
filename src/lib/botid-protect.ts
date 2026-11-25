/**
 * Client-safe BotID config. Shared by `instrumentation-client.ts` (which
 * attaches challenge headers) and the server helper (which verifies them).
 * The path list and checkLevel must stay in lockstep — a mismatch makes
 * checkBotId() fail and can block real people or let bots through.
 *
 * Basic is free on every Vercel plan. We pin it in code so flipping
 * "Deep Analysis" in the dashboard cannot silently start $1/1,000-check
 * billing. Deep Analysis is a follow-up, not the default.
 */
export const BOTID_CHECK_LEVEL = "basic" as const;

/**
 * Public, unauthenticated surfaces that cost money or create records.
 *
 * For Server Actions, BotID wants the *page* path the form lives on, not
 * an /api URL. /contact and /intake/[token] are the only first-party
 * public forms today.
 *
 * Deliberately not listed:
 * - /api/chat — the widget runs on other people's websites, and BotID
 *   requires the challenge to run on a document we serve (or a host in
 *   extraAllowedHosts). We can't list every customer domain, and without
 *   the client headers checkBotId() would 403 every real chat.
 * - /api/webhooks/*, /api/cron/*, /api/agent-tools/* — server-to-server.
 * - Authenticated app APIs (test-call, portal, calendar OAuth).
 * - Clerk /sign-up — Clerk owns that form; we have no public signup API.
 */
export const BOTID_PROTECTED_ROUTES: {
  path: string;
  method: "POST";
  advancedOptions: { checkLevel: typeof BOTID_CHECK_LEVEL };
}[] = [
  { path: "/contact", method: "POST", advancedOptions: { checkLevel: BOTID_CHECK_LEVEL } },
  { path: "/intake/*", method: "POST", advancedOptions: { checkLevel: BOTID_CHECK_LEVEL } },
];

export const BOT_BLOCKED_MESSAGE =
  "We couldn't tell this came from a person. Refresh the page and try again, or write to arigberkowitz@gmail.com.";
