import { describe, expect, it } from "vitest";
import { tidyBusinessName } from "./format";

describe("tidyBusinessName", () => {
  it("capitalizes an all-lowercase name", () => {
    expect(tidyBusinessName("lifetime chiro")).toBe("Lifetime Chiro");
    expect(tidyBusinessName("  the  fade factory ")).toBe("The Fade Factory");
    expect(tidyBusinessName("bar of soap")).toBe("Bar of Soap");
    expect(tidyBusinessName("o'brien's plumbing")).toBe("O'Brien's Plumbing");
    expect(tidyBusinessName("smith-jones dental")).toBe("Smith-Jones Dental");
  });
  it("leaves any name with a capital alone", () => {
    expect(tidyBusinessName("McBride Dental")).toBe("McBride Dental");
    expect(tidyBusinessName("AT&T Store")).toBe("AT&T Store");
    expect(tidyBusinessName("iFix Phones")).toBe("iFix Phones");
  });
});
