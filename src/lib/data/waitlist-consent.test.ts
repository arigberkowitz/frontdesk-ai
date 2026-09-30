import { describe, expect, it, vi } from "vitest";

let fail = false;
const inserted: Record<string, unknown>[] = [];
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          if (fail) throw new Error("db down");
          return [{ phone: "+14155550100" }, { phone: "" }];
        },
      }),
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        if (fail) throw new Error("db down");
        inserted.push(v);
      },
    }),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getWaitlistConsentedPhones, recordWaitlistConsent, WAITLIST_CONSENT_WORDING } = await import(
  "./waitlist-consent"
);

describe("waitlist consent", () => {
  it("records the yes under its own wording", async () => {
    await recordWaitlistConsent({ clientId: "c1", phone: "+14155550100", callId: null });
    expect(inserted[0]).toMatchObject({ clientId: "c1", phone: "+14155550100", wording: WAITLIST_CONSENT_WORDING });
    expect(WAITLIST_CONSENT_WORDING).not.toBe("booking-v1");
  });

  it("returns normalized numbers and skips blanks", async () => {
    fail = false;
    expect([...(await getWaitlistConsentedPhones("c1"))]).toEqual(["14155550100"]);
  });

  it("fails closed on lookup errors, and never throws on record errors", async () => {
    fail = true;
    expect((await getWaitlistConsentedPhones("c1")).size).toBe(0);
    await expect(recordWaitlistConsent({ clientId: "c1", phone: "+1" })).resolves.toBeUndefined();
    fail = false;
  });
});
