import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline } from "./sparkline";

describe("Sparkline", () => {
  it("renders area, line, end dot and one tooltip per point", () => {
    const html = renderToStaticMarkup(
      createElement(Sparkline, { data: [0, 2, 1, 3], labels: ["a", "b", "c", "d"], color: "#10b981" }),
    );
    expect(html).toContain("<polygon");
    expect(html).toContain("<polyline");
    expect(html).toContain("<circle");
    expect((html.match(/<title>/g) ?? []).length).toBe(4);
  });

  it("keeps a flat series low instead of mid-chart", () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { data: [0, 0, 0] }));
    expect(html).toMatch(/points="0\.0,20\.0 50\.0,20\.0 100\.0,20\.0"/);
  });

  it("renders nothing for fewer than two points", () => {
    expect(renderToStaticMarkup(createElement(Sparkline, { data: [1] }))).toBe("");
  });
});
