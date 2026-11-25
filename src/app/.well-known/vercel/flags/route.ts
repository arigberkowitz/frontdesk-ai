import { NextRequest, NextResponse } from "next/server";
import { createFlagsDiscoveryEndpoint, getProviderData } from "flags/next";
import { pricingHeadlineFlag, pricingHighlightFlag } from "@/flags";

/**
 * Flags Explorer (Vercel Toolbar) discovery endpoint.
 *
 * `createFlagsDiscoveryEndpoint` already rejects requests without a valid
 * Authorization header (401). On Vercel, flags 4.5+ can verify with the
 * deployment's own key, so this works even when FLAGS_SECRET is unset.
 *
 * Off Vercel (local `next start`, a custom host) verification needs
 * FLAGS_SECRET. We fail closed with 401 instead of letting the handler throw
 * and taking the page down. The marketing site does not read this route.
 *
 * Do not require Ari to set FLAGS_SECRET for the site to function. Setting it
 * (and optionally pulling it into .env.local) only enables Toolbar overrides.
 */
const discover = createFlagsDiscoveryEndpoint(async () => {
  return getProviderData({ pricingHeadlineFlag, pricingHighlightFlag });
});

export async function GET(request: NextRequest) {
  if (!process.env.FLAGS_SECRET && process.env.VERCEL !== "1") {
    return NextResponse.json(
      { error: "Flags Explorer is off until FLAGS_SECRET is set." },
      { status: 401 },
    );
  }
  return discover(request);
}
