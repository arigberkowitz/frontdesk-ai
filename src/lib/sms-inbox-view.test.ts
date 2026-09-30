import { describe, expect, it } from "vitest";
import { buildNameIndex, messageKindLabel, nameFor, parseThreadParam, previewText } from "./sms-inbox-view";

describe("sms inbox view helpers", () => {
  it("labels what a message was, and nothing for a plain reply", () => {
    expect(messageKindLabel("appointment_confirmation")).toBe("Booking confirmation");
    expect(messageKindLabel("opt_out")).toBe("Opted out (STOP)");
    expect(messageKindLabel("reply")).toBeNull();
    expect(messageKindLabel(null)).toBeNull();
    expect(messageKindLabel("something_new")).toBeNull();
  });

  it("names a thread from the freshest booking/lead name for that number", () => {
    const idx = buildNameIndex([
      { phone: "+1 (415) 555-0100", name: "Sam Newer" },
      { phone: "4155550100", name: "Sam Older" },
      { phone: null, name: "Nobody" },
    ]);
    expect(nameFor(idx, "14155550100")).toBe("Sam Newer");
    expect(nameFor(idx, "14155550999")).toBeNull();
  });

  it("previews with a 'You:' prefix for our own texts and clips long ones", () => {
    expect(previewText("hi\nthere", "inbound")).toBe("hi there");
    expect(previewText("hello", "outbound")).toBe("You: hello");
    expect(previewText("x".repeat(200), "inbound", 20)).toHaveLength(20);
  });

  it("only accepts a digits-only phone in the thread URL", () => {
    expect(parseThreadParam("14155550100")).toBe("14155550100");
    expect(parseThreadParam("%2B14155550100")).toBeNull();
    expect(parseThreadParam("1415' or 1=1")).toBeNull();
    expect(parseThreadParam("123")).toBeNull();
    expect(parseThreadParam("%E0%A4%A")).toBeNull();
  });
});
