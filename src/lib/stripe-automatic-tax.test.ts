import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPLICABLE_TAX_NOTE,
  checkoutAutomaticTaxParams,
  inlinePriceTaxBehavior,
  isAutomaticTaxEnabled,
  subscriptionAutomaticTaxParams,
  withApplicableTax,
} from "./stripe-automatic-tax";

afterEach(() => vi.unstubAllEnvs());

describe("isAutomaticTaxEnabled", () => {
  it("is off by default, and for any value other than exactly on", () => {
    expect(isAutomaticTaxEnabled(undefined)).toBe(false);
    expect(isAutomaticTaxEnabled("")).toBe(false);
    expect(isAutomaticTaxEnabled("true")).toBe(false);
    expect(isAutomaticTaxEnabled("ON")).toBe(false);
    expect(isAutomaticTaxEnabled("on")).toBe(true);
  });

  it("reads STRIPE_AUTOMATIC_TAX from the environment", () => {
    vi.stubEnv("STRIPE_AUTOMATIC_TAX", "");
    expect(isAutomaticTaxEnabled()).toBe(false);
    vi.stubEnv("STRIPE_AUTOMATIC_TAX", "on");
    expect(isAutomaticTaxEnabled()).toBe(true);
  });
});

describe("checkoutAutomaticTaxParams", () => {
  it("adds nothing when the flag is off, so merging changes no checkout fields", () => {
    expect(checkoutAutomaticTaxParams(undefined, false)).toEqual({});
    expect(checkoutAutomaticTaxParams({ hasCustomer: true }, false)).toEqual({});
  });

  it("requires a billing address for a new customer", () => {
    expect(checkoutAutomaticTaxParams(undefined, true)).toEqual({
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
    });
  });

  it("also updates the Customer address when one already exists", () => {
    expect(checkoutAutomaticTaxParams({ hasCustomer: true }, true)).toEqual({
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
    });
  });
});

describe("subscriptionAutomaticTaxParams and inline prices", () => {
  it("adds automatic_tax only when enabled", () => {
    expect(subscriptionAutomaticTaxParams(false)).toEqual({});
    expect(subscriptionAutomaticTaxParams(true)).toEqual({ automatic_tax: { enabled: true } });
  });

  it("marks inline prices exclusive only when enabled", () => {
    expect(inlinePriceTaxBehavior(false)).toEqual({});
    expect(inlinePriceTaxBehavior(true)).toEqual({ tax_behavior: "exclusive" });
  });
});

describe("withApplicableTax", () => {
  it("leaves prices alone when tax is off", () => {
    expect(withApplicableTax("$300/mo", false)).toBe("$300/mo");
  });

  it("appends the note once when tax is on", () => {
    expect(withApplicableTax("$300/mo", true)).toBe(`$300/mo ${APPLICABLE_TAX_NOTE}`);
    expect(withApplicableTax(`$300/mo ${APPLICABLE_TAX_NOTE}`, true)).toBe(
      `$300/mo ${APPLICABLE_TAX_NOTE}`,
    );
  });
});
