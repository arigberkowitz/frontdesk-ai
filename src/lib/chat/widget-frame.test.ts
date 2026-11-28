import { describe, expect, it } from "vitest";
import { frameCsp, frameHtml } from "./widget-frame";

describe("frameCsp", () => {
  it("is strict and self-only, with the owner's domains as frame-ancestors", () => {
    const csp = frameCsp(["acme.example"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'self' https://acme.example https://www.acme.example");
    expect(csp).toContain("report-uri /api/csp-report");
  });
  it("an unavailable frame may sit anywhere (it renders nothing)", () => {
    expect(frameCsp(null)).toContain("frame-ancestors *");
  });
});

describe("frameHtml", () => {
  it("has no inline script or style and escapes the business name", () => {
    const html = frameHtml({
      available: true,
      key: "fdw_abcdefghijklmnopqrstuvwxyz012345",
      businessName: `Bob's "Best" <script>alert(1)</script>`,
      agentName: "Riley",
      lang: "en",
      accent: "#4f46e5",
    });
    expect(html).not.toMatch(/<script>(?!<\/script>)/);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/style=/);
    expect(html).toContain('<script src="/widget/frame.js" defer></script>');
    expect(html).toContain('data-available="1"');
  });
  it("leaves the key and name out when unavailable", () => {
    const html = frameHtml({ available: false, lang: "es", accent: "#4f46e5" });
    expect(html).toContain('data-available="0"');
    expect(html).not.toContain("data-key");
    expect(html).toContain('lang="es"');
  });
});
