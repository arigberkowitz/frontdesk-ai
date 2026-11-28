import { NextRequest, NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { PROTECTED_ROUTE_PATTERNS } from "@/lib/route-access";
import { cspHeadersFor } from "@/lib/csp";
import {
  isUsableVisitorId,
  newVisitorId,
  VISITOR_COOKIE,
  visitorCookieOptions,
} from "@/lib/visitor-id";

/**
 * The old Vercel alias served a byte-identical copy of every legal page. TCR
 * rejects a brand when it finds "multiple or inconsistent privacy policies" it
 * can't reconcile (error 30908), and a reviewer who searches for us can easily
 * land on the wrong host. A canonical <link> asks nicely; a 308 settles it.
 *
 * Matched by exact hostname, not a *.vercel.app suffix — preview deployments
 * live on that suffix too and must keep working.
 */
const LEGACY_HOST = "frontdesk-ai-alpha.vercel.app";
const CANONICAL_HOST = "frontdeskai.company";

/**
 * Clerk auth gate. In Next 16 the middleware file convention is `proxy.ts`
 * (formerly `middleware.ts`); Clerk 7.4+ supports both on Next 16 and we use the
 * modern name. See DECISIONS.md.
 *
 * Public routes: the auth pages, plus machine-to-machine endpoints that
 * authenticate by signature/secret rather than a Clerk session — Retell webhooks
 * (`x-retell-signature`), Stripe webhooks, and agent tool callbacks.
 *
 * The legal pages MUST stay public: carrier/TCR reviewers open the privacy,
 * terms, and SMS-consent URLs submitted with the A2P campaign — a sign-in
 * redirect there gets the campaign rejected ("could not verify CTA").
 */
const isPublicRoute = createRouteMatcher([
  "/", // public marketing landing (page.tsx routes signed-in users to their app)
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/intake(.*)",
  "/terms",
  "/privacy",
  "/sms-consent",
  // Metadata routes (src/app/robots.ts, sitemap.ts, opengraph-image.tsx,
  // apple-icon.tsx). Crawlers and link-preview bots have no session, so a
  // sign-in redirect here hides the sitemap and breaks share cards.
  "/robots.txt",
  "/sitemap.xml",
  // Flags Explorer discovery. Public metadata, gated by FLAGS_SECRET inside the route.
  "/.well-known(.*)",
  "/opengraph-image(.*)",
  "/apple-icon(.*)",
  // The one route a stranger takes to ask for a trial. Leaving it off this list
  // sent everyone who clicked "Ask us for a trial" to a sign-in wall — asking
  // people to create an account before they're allowed to ask a question.
  "/contact",
  "/api/webhooks(.*)",
  "/api/agent-tools(.*)",
  "/api/cron(.*)",
  // The website chat (Pro). Public on purpose: visitors on the business's own
  // site have no account here. The frame is embedded on their pages and the
  // endpoint is called by that frame; both gate on the widget key, the chat
  // being on, the plan, and the owner's allowed domains, and rate-limit by IP.
  "/widget/frame",
  "/api/chat",
  "/api/csp-report",
]);

/**
 * Endpoints called by machines that authenticate per-request (signature or
 * shared secret) rather than by session. These must be served wherever they're
 * addressed — never redirected — because a redirect invalidates the signature.
 */
const isMachineRoute = createRouteMatcher([
  "/api/webhooks(.*)",
  "/api/agent-tools(.*)",
  "/api/cron(.*)",
  "/api/chat",
  "/api/csp-report",
]);

/**
 * The app's own areas (see src/lib/route-access.ts). Only these are gated, so a
 * URL that isn't an app area — including one that doesn't exist — reaches
 * Next and gets the real 404 page instead of a sign-in redirect.
 */
const isProtectedRoute = createRouteMatcher([...PROTECTED_ROUTE_PATTERNS]);

export default clerkMiddleware(async (auth, req) => {
  // Before any auth work: one canonical home for the site. Both hosts are
  // literals rather than env-derived — APP_URL falls back to Vercel's injected
  // production URL, which can itself be the legacy host, and a middleware that
  // redirects a host to itself is an infinite loop on every request.
  //
  // Machine callers are exempt, and that exemption is load-bearing. Twilio and
  // Retell sign each webhook against the EXACT url they post to, while our
  // verifiers rebuild that url from APP_URL. Bounce a signed POST to a different
  // host and the signatures stop matching, so the request 401s — silently, and
  // only in production. The Twilio number's webhook still points at the legacy
  // host, and that handler is what processes STOP: breaking it would drop
  // opt-outs on the floor while everything looked fine.
  if (req.headers.get("host") === LEGACY_HOST && !isMachineRoute(req)) {
    const to = new URL(req.url);
    to.protocol = "https:";
    to.host = CANONICAL_HOST;
    return NextResponse.redirect(to, 308);
  }

  if (isProtectedRoute(req) && !isPublicRoute(req)) {
    // Send unauthenticated visitors to our own /sign-in page (the custom animated
    // flow) instead of Clerk's hosted Account Portal.
    await auth.protect({
      unauthenticatedUrl: new URL("/sign-in", req.url).toString(),
    });
  }

  // Machine callers sign the exact URL they post to. A Set-Cookie on those
  // responses is unused and not worth adding to a signed request path.
  if (isMachineRoute(req) || req.nextUrl.pathname.startsWith("/api/")) {
    return;
  }
  // The website chat frame sets its own, stricter CSP (with the owner's
  // domains in frame-ancestors) and must not get a visitor cookie: it runs
  // on other people's sites. See src/lib/chat/widget-frame.ts.
  if (req.nextUrl.pathname === "/widget/frame") {
    return;
  }
  return nextWithVisitorId(req);
});

/**
 * Give every browser visitor a stable anonymous id, and make it visible to
 * this same request's server components. Setting the cookie only on the
 * response would leave the first page view without an id, so decide() would
 * fall back to control and the next load would flip to the real bucket.
 */
function nextWithVisitorId(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  // Content-Security-Policy (see src/lib/csp.ts, which also holds the one
  // switch from report-only to enforcing). The policy goes on the REQUEST so
  // Next and Clerk can read the nonce off it while rendering, and on the
  // response so the browser applies it. Pages only: API routes return JSON and
  // never reach this function.
  const csp = cspHeadersFor({
    nodeEnv: process.env.NODE_ENV,
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  });
  requestHeaders.set("x-nonce", csp.nonce);
  requestHeaders.set(csp.name, csp.value);
  const existing = req.cookies.get(VISITOR_COOKIE)?.value;
  const hasId = isUsableVisitorId(existing);
  const id = hasId ? existing : newVisitorId();
  if (!hasId) {
    const cookie = `${VISITOR_COOKIE}=${id}`;
    const header = requestHeaders.get("cookie");
    requestHeaders.set("cookie", header ? `${header}; ${cookie}` : cookie);
  }
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(csp.name, csp.value);
  if (!hasId) {
    const secure = req.nextUrl.protocol === "https:";
    res.cookies.set(VISITOR_COOKIE, id, visitorCookieOptions(secure));
  }
  return res;
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …and always on API routes.
    "/(api|trpc)(.*)",
  ],
};

