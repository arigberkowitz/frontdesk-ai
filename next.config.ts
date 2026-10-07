import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Document uploads (Teach it from a document): PDFs/DOCX up to 8 MB.
      bodySizeLimit: "8mb",
    },
  },
  async headers() {
    return [
      {
        // The push service worker: always revalidate so a fix reaches phones on
        // the next visit instead of whenever the browser's 24h cap expires.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/portal.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
