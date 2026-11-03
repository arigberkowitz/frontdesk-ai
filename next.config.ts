import type { NextConfig } from "next";

export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Document uploads (Teach it from a document): PDFs/DOCX up to 8 MB.
      bodySizeLimit: "8mb",
    },
  },
  async redirects() {
    return [{ source: "/pricing", destination: "/#pricing", permanent: false }];
  },
  async headers() {
    return [
      {
        // Baseline hardening for every page: no framing (clickjacking on the
        // portal), no MIME sniffing, no full URLs leaked to other sites, and no
        // camera/location access. The mic stays allowed for the browser test call.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
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
