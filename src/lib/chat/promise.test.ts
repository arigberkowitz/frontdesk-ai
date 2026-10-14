import { describe, expect, it } from "vitest";
import { promisesCodeSend } from "./session";
import { cleanEmail } from "../email-address";

describe("promisesCodeSend", () => {
  it("catches the production reply", () => {
    expect(promisesCodeSend("Let me send a verification code to 415-747-5690.")).toBe(true);
    expect(promisesCodeSend("I'll text you a code now")).toBe(true);
    expect(promisesCodeSend("I've sent a code to that number.")).toBe(true);
  });
  it("ignores unrelated replies", () => {
    expect(promisesCodeSend("What's the zip code for the visit?")).toBe(false);
    // An offer is not a promise — don't force a send the visitor didn't choose.
    expect(promisesCodeSend("I can email the code instead if you prefer.")).toBe(false);
    expect(promisesCodeSend("You're booked for Thursday at 10 AM.")).toBe(false);
  });
});

describe("cleanEmail", () => {
  it("normalises and rejects junk", () => {
    expect(cleanEmail(" A@B.co ")).toBe("a@b.co");
    expect(cleanEmail("nope")).toBeNull();
    expect(cleanEmail("a@b")).toBeNull();
    expect(cleanEmail(undefined)).toBeNull();
  });
});
