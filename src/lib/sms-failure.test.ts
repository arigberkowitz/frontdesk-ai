import { describe, expect, it } from "vitest";
import { friendlySmsFailure } from "./sms-failure";

describe("friendlySmsFailure", () => {
  it("never echoes vendor detail", () => {
    for (const raw of ["Authenticate (Twilio 20003)", "Internal error 500", "ECONNRESET"]) {
      expect(friendlySmsFailure(raw)).toBeNull();
    }
  });
  it("explains the cases an owner can act on", () => {
    expect(friendlySmsFailure("Attempt to send to unsubscribed recipient (Twilio 21610)")).toMatch(/opted out/);
    expect(friendlySmsFailure("The 'To' number is not a valid phone number (Twilio 21211)")).toMatch(/can't receive/);
  });
});
