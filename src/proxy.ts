import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
  // The one route a stranger takes to ask for a trial. Leaving it off this list
  // sent everyone who clicked "Ask us for a trial" to a sign-in wall — asking
  // people to create an account before they're allowed to ask a question.
  "/contact",
  "/api/webhooks(.*)",
  "/api/agent-tools(.*)",
  "/api/cron(.*)",
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
]);

const realMiddleware = clerkMiddleware(async (auth, req) => {
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

  if (!isPublicRoute(req)) {
    // Send unauthenticated visitors to our own /sign-in page (the custom animated
    // flow) instead of Clerk's hosted Account Portal.
    await auth.protect({
      unauthenticatedUrl: new URL("/sign-in", req.url).toString(),
    });
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …and always on API routes.
    "/(api|trpc)(.*)",
  ],
};

// TEMP LOCAL PREVIEW ONLY — never commit.
export default process.env.CLERK_DISABLE === "1"
  ? function previewMiddleware() {}
  : realMiddleware;
