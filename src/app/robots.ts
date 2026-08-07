import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

const SITE_URL = env.APP_URL;

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
