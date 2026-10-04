import { describe, expect, it } from "vitest";
import { isLightOnlyPath } from "./theme-routes";

describe("isLightOnlyPath", () => {
  it("forces light on every operator page", () => {
    for (const p of ["/dashboard", "/clients", "/clients/abc", "/clients/abc/calls/x", "/review", "/growth", "/demo", "/settings", "/platform"]) {
      expect(isLightOnlyPath(p), p).toBe(true);
    }
  });

  it("forces light on the customer portal and onboarding", () => {
    expect(isLightOnlyPath("/portal")).toBe(true);
    expect(isLightOnlyPath("/portal/messages/14155550100")).toBe(true);
    expect(isLightOnlyPath("/welcome")).toBe(true);
  });

  it("leaves marketing and legal pages alone", () => {
    for (const p of ["/", "/terms", "/privacy", "/contact", "/sign-in", "/intake/tok"]) {
      expect(isLightOnlyPath(p), p).toBe(false);
    }
    expect(isLightOnlyPath(null)).toBe(false);
  });

  it("does not over-match look-alike paths", () => {
    expect(isLightOnlyPath("/dashboards")).toBe(false);
    expect(isLightOnlyPath("/portal-info")).toBe(false);
  });
});
