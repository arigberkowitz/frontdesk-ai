import type { MetadataRoute } from "next";

const SITE_URL = process.env.APP_URL || "https://frontdesk-ai-alpha.vercel.app";

/** Index the marketing surface; keep every tenant/app surface out of search. */
export default function robots(): MetadataRoute.Robots {
  const base = SITE_URL.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/clients",
          "/portal",
          "/settings",
          "/platform",
          "/review",
          "/growth",
          "/demo",
          "/welcome",
          "/intake",
          "/api",
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
