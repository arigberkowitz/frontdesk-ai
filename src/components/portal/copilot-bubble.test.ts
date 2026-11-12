import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/copilot", () => ({ copilotAction: vi.fn() }));

const { CopilotBubble } = await import("./copilot-bubble");

describe("CopilotBubble", () => {
  it("starts as a chat bubble with the assistant panel hidden", () => {
    const html = renderToStaticMarkup(createElement(CopilotBubble));
    expect(html).toContain('aria-label="Open Frontdesk Assistant"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("Frontdesk Assistant");
    expect(html).toContain("hidden");
    // Sits above the phone tab bar and honors the safe-area inset.
    expect(html).toContain("bottom-[calc(5.75rem+max(0.75rem,env(safe-area-inset-bottom)))]");
    expect(html).toContain("md:bottom-[max(1.5rem,env(safe-area-inset-bottom))]");
    // Nearly full width on phones.
    expect(html).toContain("inset-x-3");
  });

  it("opens a labelled dialog with the existing copilot inside", () => {
    const html = renderToStaticMarkup(createElement(CopilotBubble, { defaultOpen: true }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Frontdesk Assistant");
    expect(html).toContain('aria-label="Close Frontdesk Assistant"');
    expect(html).toContain("How many after-hours calls did I get last month?");
    expect(html).toContain('aria-expanded="true"');
  });

  it("leaves room for the operator preview banner", () => {
    const html = renderToStaticMarkup(createElement(CopilotBubble, { preview: true, defaultOpen: true }));
    expect(html).toContain("top-[calc(7.25rem+env(safe-area-inset-top))]");
  });
});
