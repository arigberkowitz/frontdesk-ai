import { beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@vercel/analytics";
import {
  FUNNEL_EVENTS,
  isFunnelEvent,
  sanitizeFunnelProps,
  trackFunnelEvent,
} from "./funnel-events";

vi.mock("@vercel/analytics", () => ({
  track: vi.fn(),
}));

const trackMock = vi.mocked(track);

describe("funnel events", () => {
  beforeEach(() => {
    trackMock.mockReset();
  });

  it("names the conversion events the product actually fires", () => {
    expect(FUNNEL_EVENTS.signupStart).toBe("signup_start");
    expect(FUNNEL_EVENTS.signupComplete).toBe("signup_complete");
    expect(FUNNEL_EVENTS.demoCallRequested).toBe("demo_call_requested");
    expect(FUNNEL_EVENTS.pricingPlanCta).toBe("pricing_plan_cta");
    expect(isFunnelEvent("signup_start")).toBe(true);
    expect(isFunnelEvent("page_view")).toBe(false);
  });

  it("keeps plan and interval, and drops names, emails, and phones", () => {
    expect(
      sanitizeFunnelProps({
        plan: "starter",
        interval: "month",
        email: "owner@biz.test",
        phone: "+14155550100",
        name: "Jordan Lee",
        firstName: "Jordan",
        customer_email: "owner@biz.test",
        customerPhone: "415-555-0100",
      }),
    ).toEqual({ plan: "starter", interval: "month" });
  });

  it("drops values that look like an email or phone even under a safe key", () => {
    expect(
      sanitizeFunnelProps({
        plan: "pro",
        note: "sam@example.com",
        other: "+1 (415) 555-0199",
      }),
    ).toEqual({ plan: "pro" });
  });

  it("drops nested objects and non-finite numbers", () => {
    expect(
      sanitizeFunnelProps({
        plan: "backup",
        ok: true,
        count: 2,
        bad: Number.NaN,
        nested: { plan: "starter" },
      }),
    ).toEqual({ plan: "backup", ok: true, count: 2 });
  });

  it("sends a known event after sanitizing props", () => {
    trackFunnelEvent("pricing_plan_cta", {
      plan: "starter",
      interval: "year",
      email: "hidden@biz.test",
    });
    expect(trackMock).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledWith("pricing_plan_cta", {
      plan: "starter",
      interval: "year",
    });
  });

  it("does not send an unknown event name", () => {
    trackFunnelEvent("delete_account", { plan: "pro" });
    expect(trackMock).not.toHaveBeenCalled();
  });
});
