import { describe, expect, it } from "vitest";
import { stateFromTwilio, tollfreeView } from "./status";

describe("toll-free status", () => {
  it("maps Twilio statuses", () => {
    expect(stateFromTwilio("PENDING_REVIEW")).toBe("submitted");
    expect(stateFromTwilio("IN_REVIEW")).toBe("submitted");
    expect(stateFromTwilio("TWILIO_APPROVED")).toBe("approved");
    expect(stateFromTwilio("TWILIO_REJECTED")).toBe("rejected");
  });
  it("pending view says 3–5 business days and hides the form", () => {
    const v = tollfreeView({ status: "submitted" } as never);
    expect(v.title).toMatch(/pending carrier approval \(3–5 business days\)/);
    expect(v.showForm).toBe(false);
  });
  it("rejected view shows the reason and allows resubmitting", () => {
    const v = tollfreeView({ status: "rejected", rejectionReason: "Website not reachable" } as never);
    expect(v.body).toContain("Website not reachable");
    expect(v.showForm).toBe(true);
    expect(v.submitLabel).toMatch(/Resubmit/);
  });
});
