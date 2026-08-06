import type { MetadataRoute } from "next";

const SITE_URL = process.env.APP_URL || "https://frontdesk-ai-alpha.vercel.app";

/** Public pages only — the app surfaces are auth-gated and excluded in robots. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL.replace(/\/$/, "");
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/sign-up`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    // Linked because A2P/TCR reviewers are told to find it, and until now the
    // only route to it was two hops in from a legal page they never visit.
    { url: `${base}/sms-consent`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
