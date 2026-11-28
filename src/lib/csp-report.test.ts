import { describe, expect, it } from "vitest";
import { parseCspReports } from "./csp-report";

describe("parseCspReports", () => {
  it("reads the legacy report-uri shape and keeps only origins", () => {
    const out = parseCspReports({
      "csp-report": {
        "document-uri": "https://frontdeskai.company/portal/calls?phone=%2B14155550123#x",
        "effective-directive": "script-src-elem",
        "violated-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/steal.js?token=abc",
        "source-file": "https://frontdeskai.company/_next/static/chunk.js",
        disposition: "report",
        referrer: "https://secret.example/?email=a@b.c",
        "original-policy": "default-src 'self'",
      },
    });
    expect(out).toEqual([
      {
        directive: "script-src-elem",
        blocked: "https://evil.example",
        page: "/portal/calls",
        source: "https://frontdeskai.company",
        disposition: "report",
      },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/token|phone|email|secret|14155550123/);
  });

  it("reads the Reporting API shape", () => {
    const out = parseCspReports([
      { type: "network-error", body: {} },
      {
        type: "csp-violation",
        body: {
          documentURL: "https://frontdeskai.company/sign-in",
          effectiveDirective: "connect-src",
          blockedURL: "https://api.example.com/v1/x",
          disposition: "enforce",
        },
      },
    ]);
    expect(out).toEqual([
      { directive: "connect-src", blocked: "https://api.example.com", page: "/sign-in", source: "", disposition: "enforce" },
    ]);
  });

  it("keeps inline/eval keywords and reduces data: and blob: URLs to their scheme", () => {
    const mk = (blocked: string) =>
      parseCspReports({ "csp-report": { "effective-directive": "script-src", "blocked-uri": blocked, "document-uri": "https://x.test/" } })[0].blocked;
    expect(mk("inline")).toBe("inline");
    expect(mk("eval")).toBe("eval");
    expect(mk("data:text/javascript;base64,AAAA")).toBe("data:");
    expect(mk("blob:https://x.test/uuid")).toBe("blob:");
  });

  it("masks id-shaped path segments on our own pages", () => {
    const [v] = parseCspReports({
      "csp-report": {
        "effective-directive": "img-src",
        "document-uri": "https://frontdeskai.company/clients/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0/calls/1234567",
      },
    });
    expect(v.page).toBe("/clients/:id/calls/:id");
  });

  it("clips long fields and strips control characters", () => {
    const [v] = parseCspReports({ "csp-report": { "effective-directive": "x".repeat(500) + "\n" } });
    expect(v.directive.length).toBeLessThanOrEqual(120);
    expect(v.directive).not.toContain("\n");
  });

  it("caps a batch at 5 and ignores junk", () => {
    const many = Array.from({ length: 20 }, () => ({ type: "csp-violation", body: { effectiveDirective: "img-src" } }));
    expect(parseCspReports(many)).toHaveLength(5);
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports("str")).toEqual([]);
    expect(parseCspReports({ "csp-report": { nothing: 1 } })).toEqual([]);
    expect(parseCspReports([{ type: "csp-violation", body: null }])).toEqual([]);
  });
});
