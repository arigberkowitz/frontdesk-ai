import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Clerk auth gate. In Next 16 the middleware file convention is `proxy.ts`
 * (formerly `middleware.ts`); Clerk 7.4+ supports both on Next 16 and we use the
 * modern name. See DECISIONS.md.
 *
 * Public routes: the auth pages, plus machine-to-machine endpoints that
 * authenticate by signature/secret rather than a Clerk session — Retell webhooks
 * (`x-retell-signature`), Stripe webhooks, and agent tool callbacks.
 */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",
  "/api/agent-tools(.*)",
  "/api/cron(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
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
