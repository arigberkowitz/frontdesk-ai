import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Document uploads (Teach it from a document): PDFs/DOCX up to 8 MB.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
