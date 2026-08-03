import { describe, expect, it } from "vitest";
import { isE164, toE164 } from "@/lib/format";

describe("toE164", () => {
  // The exact value that broke provisioning for Lawyers for Justice: ten bare
  // digits, saved from a form where nobody types a country code.
  it("adds the country code to a bare US number", () => {
    expect(toE164("4088329827")).toBe("+14088329827");
  });

  it("accepts the ways people actually type phone numbers", () => {
    for (const input of [
      "(408) 832-9827",
      "408-832-9827",
      "408.832.9827",
      "408 832 9827",
      " 4088329827 ",
      "1 (408) 832-9827",
      "+1 408 832 9827",
      "+1 (408) 832-9827",
    ]) {
      expect(toE164(input), input).toBe("+14088329827");
    }
  });

  it("leaves a valid international number alone", () => {
    expect(toE164("+442071838750")).toBe("+442071838750");
    expect(toE164("+44 20 7183 8750")).toBe("+442071838750");
  });

  // Returning null beats guessing: a wrong destination either rings a stranger
  // or dies at the moment a caller asks for a human.
  it("refuses anything it can't parse confidently", () => {
    for (const input of ["", "   ", "832-9827", "555", "abc", "+1", "+123", null, undefined]) {
      expect(toE164(input as string), String(input)).toBeNull();
    }
  });

  it("refuses a number longer than E.164 allows", () => {
    expect(toE164("+1234567890123456")).toBeNull();
  });

  it("is idempotent — normalizing twice changes nothing", () => {
    const once = toE164("(408) 832-9827");
    expect(toE164(once)).toBe(once);
  });
});

describe("isE164", () => {
  it("accepts only fully-qualified numbers", () => {
    expect(isE164("+14088329827")).toBe(true);
    expect(isE164("+442071838750")).toBe(true);
  });

  it("rejects what Retell would reject", () => {
    for (const bad of ["4088329827", "(408) 832-9827", "+0123456789", "", null, undefined]) {
      expect(isE164(bad as string), String(bad)).toBe(false);
    }
  });
});
