import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { evaluate } from "flags/next";
import { getCurrentDbUser, operatorHomePath } from "@/lib/auth-guard";
import type { Metadata } from "next";
import { LandingPage } from "@/components/landing-page";
import { pricingHeadlineFlag, pricingHighlightFlag } from "@/flags";

// The legal pages declare a canonical; the homepage didn't. Relative to
// metadataBase (APP_URL), so it resolves to the canonical host.
export const metadata: Metadata = { alternates: { canonical: "/" } };

/**
 * Root entry. Public marketing landing for visitors; signed-in users are routed
 * to where they belong — an agency operator to the admin dashboard, a self-serve
 * business owner (or client viewer) to their own portal.
 */
export default async function Home() {
  const { userId } = await auth();
  if (userId) {
    const user = await getCurrentDbUser();
    redirect(await operatorHomePath(user));
  }
  // The landing page is already dynamic because of the auth() check above, so
  // evaluating flags here does not give up a static page. Precompute would keep
  // a fully static marketing route cacheable, but it needs a signing secret
  // off Vercel (FLAGS_SECRET or FLAGS_PRECOMPUTE_SECRET). We stay dynamic so
  // the site works when those env vars are unset, and default to control when
  // the visitor cookie is missing.
  const { pricingHeadline, pricingHighlight } = await evaluate({
    pricingHeadline: pricingHeadlineFlag,
    pricingHighlight: pricingHighlightFlag,
  });
  return (
    <LandingPage
      pricingHeadline={pricingHeadline}
      pricingHighlight={pricingHighlight}
    />
  );
}
