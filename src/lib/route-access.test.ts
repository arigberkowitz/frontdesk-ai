import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_ROUTE_PATTERNS, PUBLIC_TOP_LEVEL_SEGMENTS, isProtectedPath } from "./route-access";

const APP_DIR = path.resolve(__dirname, "../app");

/** Top-level URL segments under src/app, flattening (route groups). */
function topLevelSegments(dir = APP_DIR): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("(") && name.endsWith(")")) out.push(...topLevelSegments(full));
    else if (!name.startsWith("_") && !name.startsWith("[")) out.push(name);
  }
  return out;
}

describe("route access", () => {
  it("classifies every top-level app route as protected or deliberately public", () => {
    const publicSet = new Set<string>(PUBLIC_TOP_LEVEL_SEGMENTS);
    const unclassified = topLevelSegments().filter(
      (seg) => !publicSet.has(seg) && !isProtectedPath(`/${seg}`),
    );
    expect(unclassified).toEqual([]);
  });

  it("protects app areas and their subpaths", () => {
    for (const p of ["/dashboard", "/clients/123", "/portal", "/portal/calls/1", "/settings", "/api/clients/1/export"]) {
      expect(isProtectedPath(p)).toBe(true);
    }
  });

  it("leaves unknown paths and public pages to Next (404 / public page)", () => {
    for (const p of ["/nonexistent-page-xyz", "/llms.txt", "/pricing", "/", "/terms", "/robots.txt", "/opengraph-image"]) {
      expect(isProtectedPath(p)).toBe(false);
    }
  });

  it("mirrors Clerk's prefix semantics (look-alikes are over-protected, never exposed)", () => {
    expect(isProtectedPath("/demos")).toBe(true);
    expect(isProtectedPath("/apiary")).toBe(true);
  });

  it("patterns are all prefix matchers", () => {
    for (const p of PROTECTED_ROUTE_PATTERNS) expect(p.endsWith("(.*)")).toBe(true);
  });
});
