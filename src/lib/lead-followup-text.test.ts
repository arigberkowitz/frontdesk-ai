import { describe, expect, it } from "vitest";
import {
  confirmReplyText,
  genericFollowUpText,
  OPT_OUT_LINE,
  smsSegments,
  withOptOut,
} from "./lead-followup-text";
import { hasMoreThanKeyword, optOutKeyword } from "@/app/api/webhooks/twilio/route";

const CTX = {
  businessName: "Lawyers for justice",
  customerName: "Ari Berkowitz",
  service: "Consultation",
  timing: "tomorrow",
};

describe("the text the owner actually sends", () => {
  it("asks for an answer instead of promising a phone call", () => {
    const body = confirmReplyText(CTX);
    expect(body).toContain("Reply YES to confirm or NO to reschedule");
    // The draft that started this promised "our team will call you shortly",
    // which the model invented on the business's behalf.
    expect(body).not.toMatch(/call you/i);
  });

  it("uses what the caller actually said they wanted", () => {
    expect(confirmReplyText(CTX)).toContain("your consultation tomorrow");
  });

  it("still reads properly when the caller said neither", () => {
    const body = confirmReplyText({ businessName: "Bright Smile", customerName: null });
    expect(body).toBe(
      "Hi, it's Bright Smile — confirming your appointment. Reply YES to confirm or NO to reschedule.",
    );
  });

  it("greets by first name only", () => {
    expect(confirmReplyText(CTX).startsWith("Hi Ari,")).toBe(true);
  });
});

describe("the opt-out line", () => {
  it("is added to anything the owner types", () => {
    expect(withOptOut("Running late, see you at 3")).toBe(
      `Running late, see you at 3 ${OPT_OUT_LINE}`,
    );
  });

  // It's appended on the server precisely so it can't be deleted in the box.
  it("isn't doubled up when the message already mentions STOP", () => {
    const already = `See you then. ${OPT_OUT_LINE}`;
    expect(withOptOut(already)).toBe(already);
  });

  it("survives an empty message rather than sending a bare space", () => {
    expect(withOptOut("   ")).toBe(OPT_OUT_LINE);
  });
});

describe("how many texts this really is", () => {
  it("counts a short message as one", () => {
    expect(smsSegments("Hi Ari, see you at 3.")).toBe(1);
  });

  it("counts a long one as more than one", () => {
    expect(smsSegments("a".repeat(200))).toBe(2);
  });

  // The trap: one curly apostrophe drops the limit from 160 to 70, so a message
  // that looks short costs triple. Worth showing before they press send.
  it("knows a smart quote triples the cost", () => {
    const plain = "a".repeat(150);
    expect(smsSegments(plain)).toBe(1);
    expect(smsSegments(plain + "’")).toBe(3);
  });

  it("is zero for nothing", () => {
    expect(smsSegments("")).toBe(0);
  });
});

describe("what happens when the customer replies", () => {
  // The collision that would have broken the whole feature: "yes" is a carrier
  // START keyword and also the exact answer we ask for.
  it('treats "YES" as a start keyword — so it must not stop there', () => {
    expect(optOutKeyword("YES")).toBe("yes");
  });

  it("can tell a bare keyword from a keyword with a message attached", () => {
    expect(hasMoreThanKeyword("STOP")).toBe(false);
    expect(hasMoreThanKeyword("stop!")).toBe(false);
    // Opted out by the carrier rules, and still a person asking for something.
    expect(hasMoreThanKeyword("Cancel my 2pm please")).toBe(true);
    expect(hasMoreThanKeyword("YES thanks")).toBe(true);
  });
});

describe("the generic fallback", () => {
  it("includes a callback number when there is one", () => {
    expect(genericFollowUpText(CTX, "(408) 832-9827")).toContain("(408) 832-9827");
  });

  it("doesn't invent one when there isn't", () => {
    expect(genericFollowUpText(CTX, null)).not.toContain("reach us at");
  });
});
