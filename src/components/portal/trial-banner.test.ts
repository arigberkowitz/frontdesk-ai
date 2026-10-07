import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** The Overview trial card: countdown, real numbers, and the upgrade button. */

vi.mock("@/lib/actions/billing", () => ({ startSelfServeCheckoutAction: vi.fn() }));
vi.mock("@/lib/actions/trial-nudges", () => ({ setTrialReminderAction: vi.fn() }));

const { TrialBanner } = await import("./trial-banner");

const active = {
  active: true,
  expired: false,
  daysLeft: 9,
  endsAt: new Date("2026-10-16T16:00:00Z"),
  comped: false,
  subscribed: false,
};
const progress = { calls: 14, booked: 6, afterHours: 5, since: new Date("2026-10-02T16:00:00Z") };
const upgrade = (canCheckout: boolean) => ({
  clientId: "c1",
  plan: { key: "starter", name: "Starter", monthlyPriceCents: 30_000 },
  canCheckout,
});
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(TrialBanner, props as never));

describe("TrialBanner", () => {
  it("counts down and shows what the AI did this trial", () => {
    const html = render({ state: active, progress, hasNumber: true, upgrade: upgrade(true), timezone: "America/New_York" });
    expect(html).toContain("9 days left in your free trial");
    expect(html).toContain("Ends Fri, Oct 16");
    expect(html).toContain("Your AI has handled 14 calls and booked 6 appointments this trial.");
    expect(html).toMatch(/>14<[\s\S]*Calls handled/);
    expect(html).toMatch(/>6<[\s\S]*Appointments booked/);
  });

  it("the owner gets a real checkout button on their plan", () => {
    const html = render({ state: active, progress, upgrade: upgrade(true) });
    expect(html).toContain("Upgrade to Starter · $300/mo");
    expect(html).toContain('name="plan" value="starter"');
    expect(html).toContain('name="interval" value="month"');
  });

  it("staff (or no Stripe) get a link to the plans instead", () => {
    const html = render({ state: active, progress, upgrade: upgrade(false) });
    expect(html).not.toContain("Upgrade to Starter");
    expect(html).toContain('href="/portal/guidelines#plans"');
  });

  it("the reminder opt-in shows only when offered (owner), and reflects its state", () => {
    expect(render({ state: active })).not.toContain("3 days before");
    expect(render({ state: active, reminder: { clientId: "c1", on: false } })).toContain(
      "Email me 3 days before it ends",
    );
    expect(render({ state: active, reminder: { clientId: "c1", on: true } })).toContain("Reminder on");
  });

  it("gets urgent in the last three days", () => {
    const html = render({ state: { ...active, daysLeft: 2 }, progress });
    expect(html).toContain("2 days left in your free trial");
    expect(html).toContain("border-amber-500/40");
  });

  it("an expired trial says calls still work and offers the upgrade", () => {
    const html = render({ state: { ...active, active: false, expired: true, daysLeft: 0 }, progress, upgrade: upgrade(true) });
    expect(html).toContain("Your free trial has ended.");
    expect(html).toContain("still answering");
    expect(html).toContain("Upgrade to Starter");
  });

  it("paying businesses see nothing; comped ones one quiet line", () => {
    expect(render({ state: { ...active, subscribed: true }, progress })).toBe("");
    const comped = render({ state: { ...active, active: false, comped: true } });
    expect(comped).toContain("on the house");
    expect(comped).not.toContain("Upgrade");
  });
});
