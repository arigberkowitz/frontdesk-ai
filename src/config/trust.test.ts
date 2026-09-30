import { describe, expect, it } from "vitest";
import { TESTIMONIALS, publishableTestimonials, type Testimonial } from "./trust";

describe("landing testimonials", () => {
  it("ships with no testimonials (nothing invented)", () => {
    expect(TESTIMONIALS).toEqual([]);
    expect(publishableTestimonials()).toEqual([]);
  });

  it("drops incomplete entries", () => {
    const list = [
      { quote: "  ", name: "A", business: "B", permissionConfirmed: true },
      { quote: "Real words", name: "A", business: "B", permissionConfirmed: true },
    ] as Testimonial[];
    expect(publishableTestimonials(list)).toHaveLength(1);
  });
});
