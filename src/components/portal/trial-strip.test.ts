import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** The slim countdown on every portal page — except the Overview, which has the card. */

let path = "/portal/calls";
vi.mock("next/navigation", () => ({ usePathname: () => path }));
vi.mock("@/lib/actions/billing", () => ({ startSelfServeCheckoutAction: vi.fn() }));

const { TrialStrip } = await import("./trial-strip");
const props = {
  headline: "9 days left in your free trial",
  shortHeadline: "9 days left in trial",
  summary: "14 calls handled, 6 booked this trial",
  urgent: false,
  upgrade: { clientId: "c1", planKey: "starter", label: "Upgrade · $300/mo" },
};

describe("TrialStrip", () => {
  it("shows the countdown, the real numbers and the upgrade button", () => {
    path = "/portal/calls";
    const html = renderToStaticMarkup(createElement(TrialStrip, props));
    expect(html).toContain("9 days left in your free trial");
    expect(html).toContain("9 days left in trial");
    expect(html).toContain("14 calls handled, 6 booked this trial");
    expect(html).toContain("Upgrade · $300/mo");
  });

  it("hides on the Overview", () => {
    path = "/portal";
    expect(renderToStaticMarkup(createElement(TrialStrip, props))).toBe("");
  });

  it("without checkout rights it links to the plans", () => {
    path = "/portal/settings";
    const html = renderToStaticMarkup(createElement(TrialStrip, { ...props, upgrade: null }));
    expect(html).toContain("See plans");
    expect(html).not.toContain("Upgrade");
  });
});
