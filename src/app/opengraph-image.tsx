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
          // The landing page's dark stage: navy base with the same indigo and
          // emerald aurora glows, so the link preview and the page it opens
          // are recognizably one thing.
          backgroundColor: "#0b1120",
          backgroundImage:
            "radial-gradient(900px 500px at 75% -10%, rgba(99,102,241,0.35), transparent 60%), radial-gradient(700px 400px at 5% 110%, rgba(16,185,129,0.22), transparent 60%)",
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
            {/* The ☎ glyph rendered blank in every link preview — Satori's
                bundled font has no dingbat coverage. SVG can't not render. */}
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
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

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontFamily: "Arial, sans-serif",
          }}
        >
          <div style={{ fontSize: 28, color: "#9ca3af", maxWidth: 720 }}>
            The AI receptionist for local business — answers, books, and captures leads 24/7.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: 22,
              color: "#c7d2fe",
              border: "1px solid rgba(255,255,255,0.18)",
              backgroundColor: "rgba(255,255,255,0.06)",
              borderRadius: 999,
              padding: "12px 24px",
            }}
          >
            3 weeks free · no card
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
