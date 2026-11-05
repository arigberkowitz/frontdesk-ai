import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env", () => ({ env: { SUPPORT_EMAIL: "" } }));
import { smsHelpReply, smsOptInReply } from "./sms-help";

describe("SMS keyword replies", () => {
  it("HELP falls back to support@, never a personal inbox", () => {
    expect(smsHelpReply()).toMatch(/support@frontdeskai\.company/);
    expect(smsHelpReply()).not.toMatch(/gmail/);
  });
  it("START confirmation carries brand, rates, HELP and STOP", () => {
    const en = smsOptInReply(null);
    expect(en).toMatch(/^FrontDesk AI:/);
    for (const w of ["Msg&data rates may apply", "HELP", "STOP"]) expect(en).toContain(w);
  });
  it("Spanish confirmation keeps the STOP keyword in English", () => {
    const es = smsOptInReply("es");
    expect(es).toContain("Responda HELP");
    expect(es).toContain("STOP");
    expect(es).not.toBe(smsOptInReply("en"));
  });
});
