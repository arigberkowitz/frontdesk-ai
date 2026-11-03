import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Live transfer can't be "Current" when there's no number to transfer to. */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/spam", () => ({ setHandoffModeAction: vi.fn() }));

const { HandoffCard } = await import("./handoff-card");

describe("HandoffCard", () => {
  it("says transfer is off and links to Alerts when no number is set", () => {
    const html = renderToStaticMarkup(createElement(HandoffCard, { clientId: "c1", mode: "always", escalationNumber: null }));
    expect(html).toContain("Live transfer is off until you add a cell number");
    expect(html).toContain('href="/portal/settings/alerts"');
    expect(html).not.toContain(">Current<");
    expect(html).toContain("Saved · starts once a number is added");
  });

  it("marks the saved mode Current once a number exists", () => {
    const html = renderToStaticMarkup(
      createElement(HandoffCard, { clientId: "c1", mode: "always", escalationNumber: "+14155550100" }),
    );
    expect(html).toContain(">Current<");
    expect(html).not.toContain("Live transfer is off");
  });
});
