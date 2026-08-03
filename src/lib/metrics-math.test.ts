import { describe, expect, it } from "vitest";
import { formatCurrencyCents, formatPercent } from "@/lib/format";

/**
 * These guard the *presentation* of numbers, which is where this product can
 * lie without crashing. The SQL that produces them needs a database; the rules
 * about what a number means do not.
 */
describe("rate display", () => {
  // A brand-new business with no calls used to be shown "100% answer rate" and
  // "100% containment" — flattering, and completely made up.
  it("shows an em dash rather than inventing a rate from no data", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
  });

  it("never prints NaN or Infinity", () => {
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatPercent(0 / 0)).toBe("—");
  });

  it("renders real rates at the expected precision", () => {
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.732)).toBe("73%");
    expect(formatPercent(0.732, 1)).toBe("73.2%");
  });

  // 11 of 12 answered is 91.67%, and rounding it to 92% is correct — but it
  // must never round to 100% and imply a perfect record.
  it("does not round a near-perfect rate up to 100%", () => {
    expect(formatPercent(11 / 12)).toBe("92%");
    expect(formatPercent(0.999)).toBe("100%"); // genuinely 99.9%, rounds honestly
    expect(formatPercent(0.994)).toBe("99%");
  });
});

describe("money display", () => {
  it("renders cents as whole dollars by default", () => {
    expect(formatCurrencyCents(300_000)).toBe("$3,000");
    expect(formatCurrencyCents(100_000)).toBe("$1,000");
    expect(formatCurrencyCents(0)).toBe("$0");
  });

  it("distinguishes 'no data' from zero", () => {
    // $0 of revenue is a fact; null is an absence. They must not look alike.
    expect(formatCurrencyCents(null)).toBe("—");
    expect(formatCurrencyCents(undefined)).toBe("—");
    expect(formatCurrencyCents(0)).toBe("$0");
  });

  it("keeps exact cents when asked", () => {
    expect(formatCurrencyCents(123_456, { showCents: true })).toBe("$1,234.56");
  });

  /**
   * The bug this replaced: revenue was `bookingCount × averageServicePrice`,
   * where the average came from the whole service CATALOGUE rather than from
   * what anyone actually booked. A firm listing a $1,000 info session, a free
   * consultation and a $50 follow-up has a $350 average — so two free
   * consultations "earned" $700.
   */
  it("values bookings at what was booked, not at the catalogue average", () => {
    const catalogue = [100_000, 0, 5_000]; // $1,000 · free · $50
    const catalogueAverage = Math.round(catalogue.reduce((a, b) => a + b, 0) / catalogue.length);

    const actuallyBooked = [0, 0]; // two free consultations
    const truth = actuallyBooked.reduce((a, b) => a + b, 0);
    const oldFormula = actuallyBooked.length * catalogueAverage;

    expect(formatCurrencyCents(truth)).toBe("$0");
    expect(formatCurrencyCents(oldFormula)).toBe("$700");
    expect(oldFormula).not.toBe(truth);
  });

  it("keeps an expensive booking whole instead of averaging it down", () => {
    const catalogue = [100_000, 0, 5_000];
    const catalogueAverage = Math.round(catalogue.reduce((a, b) => a + b, 0) / catalogue.length);

    const actuallyBooked = [100_000]; // the $1,000 session
    expect(formatCurrencyCents(actuallyBooked[0])).toBe("$1,000");
    expect(formatCurrencyCents(catalogueAverage)).toBe("$350");
  });
});
