import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Fraunces, Sora } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_NAME, APP_DESCRIPTION, APP_TITLE } from "@/config/app";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display serif for headings — a warm, premium counterweight to the clean sans body.
// opsz (optical sizing) lets glyphs adapt from small card titles to large page titles.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

// Geometric display face for the customer portal (headings + big numbers).
// Wired up only inside the portal skin (see globals.css `--font-display`);
// marketing pages keep Fraunces. Sora ships tabular figures for stat tiles.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const SITE_URL = process.env.APP_URL || "https://frontdeskai.company";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: APP_TITLE, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  openGraph: {
    title: `${APP_NAME} — Never miss another call`,
    description: APP_DESCRIPTION,
    url: SITE_URL,
    siteName: APP_NAME,
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} — Never miss another call`,
    description: APP_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Every page is rendered per request, because the Content-Security-Policy
  // nonce (src/proxy.ts) is new for each request and Next can only stamp it on
  // scripts while rendering one — a prerendered page has no nonce, so its
  // inline scripts would be blocked once the policy enforces. Reading the
  // request headers is what opts the page in. Nearly every route was already
  // dynamic (Clerk auth); this adds only the legal pages, /contact and the SSO
  // callback, which are small.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <ClerkProvider
      // Lets Clerk put the nonce on the script tag that loads clerk-js.
      nonce={nonce}
      // Use the in-app /sign-in and /sign-up pages (the custom animated flow)
      // instead of Clerk's hosted Account Portal. After auth, land on "/" so the
      // root route can send each role to the right home.
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <html
        lang="en"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} ${sora.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          <ThemeProvider nonce={nonce}>
            <TooltipProvider delay={150}>{children}</TooltipProvider>
            <Toaster richColors closeButton />
            {/* Page views and custom funnel events (see src/lib/funnel-events.ts).
                Data only appears once Web Analytics / Speed Insights are enabled
                on the Vercel project — the components themselves are inert until then. */}
            <Analytics />
            <SpeedInsights />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
