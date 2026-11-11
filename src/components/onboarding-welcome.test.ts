import { describe, expect, it } from "vitest";
import { welcomeBusyMessage } from "./welcome-busy-message";

describe("welcomeBusyMessage", () => {
  it("mentions the website only when one was entered", () => {
    expect(welcomeBusyMessage("https://joesplumbing.com")).toMatch(/Reading your website/);
    expect(welcomeBusyMessage("joesplumbing.com")).toMatch(/Reading your website/);
    expect(welcomeBusyMessage("  ")).not.toMatch(/website/);
    expect(welcomeBusyMessage("")).not.toMatch(/website/);
    expect(welcomeBusyMessage(null)).not.toMatch(/website/);
    expect(welcomeBusyMessage(undefined)).toMatch(/Building your receptionist/);
  });
});
