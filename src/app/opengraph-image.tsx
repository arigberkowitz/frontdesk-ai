import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "FrontDesk AI — Never miss another call";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Link-preview card (OG/Twitter). Brand rail dark + gradient phone chip. */
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#11131c",
          color: "#fff",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "linear-gradient(135deg,#6366f1,#10b981)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
            }}
          >
            ☎
          </div>
          <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>FrontDesk AI</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 92, fontWeight: 600, letterSpacing: -3, lineHeight: 1.02 }}>
            Never miss
          </div>
          <div
            style={{
              fontSize: 92,
              fontWeight: 600,
              letterSpacing: -3,
              lineHeight: 1.02,
              fontStyle: "italic",
              color: "#a5b4fc",
            }}
          >
            another call.
          </div>
        </div>

        <div style={{ fontSize: 30, color: "#9ca3af", fontFamily: "Arial, sans-serif" }}>
          The AI receptionist for local business — answers, books, and captures leads 24/7.
        </div>
      </div>
    ),
    { ...size },
  );
}
