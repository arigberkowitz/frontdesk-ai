import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** "Offer a human" can't read as On when there's no number to connect to. */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/portal", () => ({ savePortalProfileAction: vi.fn(), contactSupportAction: vi.fn() }));
vi.mock("@/lib/actions/edit-lock", () => ({ setEditCodeAction: vi.fn() }));

const { HumanTouchForm } = await import("./portal-settings");

const base = { id: "c1", humanHandoffEnabled: true, humanHoursNote: null } as never;
const render = (escalationNumber: string | null) =>
  renderToStaticMarkup(
    createElement(HumanTouchForm, { client: { ...(base as object), escalationNumber } as never }),
  );

describe("HumanTouchForm", () => {
  it("shows the pending notice and Alerts link with no number", () => {
    const html = render(null);
    expect(html).toContain("Offering a human is off until you add a cell number");
    expect(html).toContain('href="/portal/settings/alerts"');
    expect(html).toContain("On (saved) — starts once a number is added");
    expect(html).not.toContain("On — offer a human when it helps");
  });

  it("reads normally once a number exists", () => {
    const html = render("+14155550100");
    expect(html).not.toContain("Offering a human is off");
    expect(html).toContain("On — offer a human when it helps");
  });
});
