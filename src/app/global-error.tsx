"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort boundary for a crash in the root layout itself, where app/error.tsx
 * can't render (it lives inside the layout). Must bring its own <html>/<body>,
 * and can't rely on the app's CSS having loaded — so styles are inline.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fafafa",
          color: "#111",
          textAlign: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#555", margin: "0 0 20px" }}>
            We hit an unexpected error and we&apos;ve been notified. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "10px 18px",
              borderRadius: 999,
              border: "1px solid #ddd",
              background: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>{" "}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full reload is the point after a root crash */}
          <a href="/" style={{ marginLeft: 12, fontSize: 14, color: "#4f46e5" }}>
            Go home
          </a>
        </div>
      </body>
    </html>
  );
}
