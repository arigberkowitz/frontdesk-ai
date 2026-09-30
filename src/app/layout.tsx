import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces, Sora } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
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

const SITE_URL = process.env.APP_URL || "https://frontdesk-ai-alpha.vercel.app";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
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
          <ThemeProvider>
            <TooltipProvider delay={150}>{children}</TooltipProvider>
            <Toaster richColors closeButton />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
