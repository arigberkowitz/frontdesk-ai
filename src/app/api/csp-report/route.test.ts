import { beforeEach, describe, expect, it, vi } from "vitest";

const warn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() },
}));

import { GET, POST } from "./route";
import { clearAttempts } from "@/lib/rate-limit";

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://frontdeskai.company/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report", ...headers },
      body,
    }),
  );

const report = JSON.stringify({
  "csp-report": {
    "document-uri": "https://frontdeskai.company/portal?email=a@b.c",
    "effective-directive": "script-src-elem",
    "blocked-uri": "https://evil.example/x.js?k=v",
  },
});

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    warn.mockReset();
    clearAttempts("csp-report");
  });

  it("logs one PII-free line per violation and answers 204", async () => {
    const res = await post(report);
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("csp.violation", {
      directive: "script-src-elem",
      blocked: "https://evil.example",
      page: "/portal",
      source: "",
      disposition: "report",
    });
  });

  it("is fail-soft: garbage, empty and wrong-shaped bodies are all 204 and log nothing", async () => {
    for (const body of ["", "not json", "[[[", "123", '{"a":1}']) {
      expect((await post(body)).status).toBe(204);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops oversized bodies without parsing them", async () => {
    const res = await post(report, { "content-length": "999999" });
    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
    const big = JSON.stringify({ "csp-report": { "effective-directive": "x", pad: "y".repeat(20_000) } });
    expect((await post(big)).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rate limits: after 60 reports a minute it stops logging but still answers 204", async () => {
    for (let i = 0; i < 70; i++) expect((await post(report)).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(60);
  });

  it("answers 405 to GET", () => {
    expect(GET().status).toBe(405);
  });
});
