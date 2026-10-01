import { describe, expect, it, vi } from "vitest";

let dbFails = false;
let rows: { phone: string; wording: string }[] = [];
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (dbFails) throw new Error("relation does not exist");
          return rows;
        },
      }),
    }),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { CONSENT_WORDING_VERSION, coveredPhones, getConsentedPhones, hasSmsConsent, isConsented } =
  await import("./sms-consents");

describe("stored SMS consent gate", () => {
  it("matches numbers regardless of formatting", () => {
    const set = coveredPhones([{ phone: "+14155550100", wording: CONSENT_WORDING_VERSION }], "recall");
    expect(isConsented(set, "(415) 555-0100")).toBe(true);
    expect(isConsented(set, "4155550100")).toBe(true);
    expect(isConsented(set, "+14155550101")).toBe(false);
    expect(isConsented(set, "")).toBe(false);
    expect(isConsented(set, null)).toBe(false);
  });

  it("ignores consent given under a wording that doesn't cover the purpose", () => {
    const set = coveredPhones([{ phone: "+14155550100", wording: "some-other-script" }], "review_request");
    expect(set.size).toBe(0);
  });

  it("a number with no consent row is not consented", async () => {
    rows = [{ phone: "+14155550100", wording: CONSENT_WORDING_VERSION }];
    dbFails = false;
    expect(await hasSmsConsent("c1", "+12125550199", "lead_followup")).toBe(false);
    expect(await hasSmsConsent("c1", "+14155550100", "lead_followup")).toBe(true);
  });

  it("fails safe: a lookup error means nobody is consented", async () => {
    rows = [{ phone: "+14155550100", wording: CONSENT_WORDING_VERSION }];
    dbFails = true;
    expect((await getConsentedPhones("c1", "recovery_lead")).size).toBe(0);
    expect(await hasSmsConsent("c1", "+14155550100", "recall")).toBe(false);
    dbFails = false;
  });
});

describe("consent asked in the caller's language", () => {
  it("the receipt records the language; English stays booking-v1", async () => {
    const { consentWordingFor } = await import("./sms-consents");
    expect(consentWordingFor(null)).toBe(CONSENT_WORDING_VERSION);
    expect(consentWordingFor("en")).toBe(CONSENT_WORDING_VERSION);
    expect(consentWordingFor("es")).toBe(`${CONSENT_WORDING_VERSION}-es`);
    expect(consentWordingFor("Klingon")).toBe(CONSENT_WORDING_VERSION);
  });
  it("a Spanish yes covers the same texts an English yes does", () => {
    const set = coveredPhones([{ phone: "+14155550100", wording: `${CONSENT_WORDING_VERSION}-es` }], "lead_followup");
    expect(isConsented(set, "+14155550100")).toBe(true);
    expect(coveredPhones([{ phone: "+14155550100", wording: "something-else" }], "lead_followup").size).toBe(0);
  });
});
