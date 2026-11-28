import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Plan picker copy: Buy now charges today and ends the in-app trial. */

vi.mock("@/lib/actions/billing", () => ({ startSelfServeCheckoutAction: vi.fn() }));

const { ChoosePlan } = await import("./choose-plan");

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(ChoosePlan, {
      clientId: "c1",
      cardsReady: true,
      ...props,
    } as never),
  );

describe("ChoosePlan", () => {
  it("during a trial, the button says pay today and the copy says the trial ends", () => {
    const html = render({ onTrial: true });
    expect(html).toContain("Start my plan now — pay $399 today");
    expect(html).toContain("Starting a plan ends your free trial and charges your card today.");
    expect(html).not.toContain("keep the rest of your free trial");
    expect(html).not.toContain("isn't charged until");
    expect(html).not.toContain("Continue —");
  });

  it("after the trial, checkout still charges today and never promises free days", () => {
    const html = render({ onTrial: false });
    expect(html).toContain("Start my plan now — pay $399 today");
    expect(html).toContain("Your card is charged today.");
    expect(html).not.toContain("keep the rest of your free trial");
  });

  it("adds + applicable tax when automatic tax is on", () => {
    const html = render({ onTrial: true, plusTax: true });
    expect(html).toContain("Start my plan now — pay $399 today + applicable tax");
  });
});
