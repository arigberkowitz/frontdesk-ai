import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Owners and their staff must never reach operator screens by typing a URL.
// The (dashboard) layout gates the whole group, and every page/route inside it
// also carries its own guard, so a layout refactor can't silently open one up.
const ROOT = join(process.cwd(), "src/app/(dashboard)");
const GUARD = /\b(requireAgencyOperator|requireOperator|requireSuperAdmin)\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /^(page|route)\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("operator routes", () => {
  it("the (dashboard) layout requires an agency operator", () => {
    expect(readFileSync(join(ROOT, "layout.tsx"), "utf8")).toMatch(/requireAgencyOperator\(/);
  });

  const files = walk(ROOT);
  it("finds the operator screens", () => {
    expect(files.length).toBeGreaterThan(5);
  });
  for (const f of files) {
    it(`${f.slice(ROOT.length)} has its own operator guard`, () => {
      const src = readFileSync(f, "utf8");
      // exit-preview only clears the caller's own preview cookie.
      if (f.endsWith("exit-preview/route.ts")) return;
      expect(src).toMatch(GUARD);
    });
  }
});
