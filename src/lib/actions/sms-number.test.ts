import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Assigning a business its own texting number: operator-only, never buys
 * anything, refuses numbers that would misroute texts (the shared number, one
 * already assigned, one not in our Twilio account), and can be undone.
 */

const ORG = "org-agency";
const CLIENT = { id: "c1", orgId: ORG, name: "Acme Dental", smsNumber: null as string | null };

let operator: { id: string; orgId: string } | null = { id: "u-op", orgId: ORG };
const requireAgencyOperator = vi.fn(async () => {
  if (!operator) throw new Error("NEXT_REDIRECT /portal");
  return operator;
});
vi.mock("@/lib/auth-guard", () => ({ requireAgencyOperator: () => requireAgencyOperator() }));

const assertClientInOrg = vi.fn(async (orgId: string, id: string) => {
  if (orgId !== ORG || id !== CLIENT.id) throw new Error("Client not found");
  return CLIENT;
});
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: (o: string, id: string) => assertClientInOrg(o, id),
}));

const setClientSmsNumber = vi.fn(async (..._a: unknown[]) => {});
const findOtherClientWithSmsNumber = vi.fn(async (..._a: unknown[]) => null as { id: string; name: string } | null);
vi.mock("@/lib/data/sms-numbers", () => ({
  setClientSmsNumber: (...a: unknown[]) => setClientSmsNumber(...a),
  findOtherClientWithSmsNumber: (...a: unknown[]) => findOtherClientWithSmsNumber(...a),
}));

const okCheck = { checked: true, found: true, smsCapable: true, webhookOk: true, smsUrl: null, isShared: false };
const checkTwilioNumber = vi.fn(async (_n: string) => ({ ...okCheck }));
vi.mock("@/lib/notifier", () => ({ checkTwilioNumber: (n: string) => checkTwilioNumber(n) }));

const audit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/lib/data/audit", () => ({ audit: (...a: unknown[]) => audit(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/env", () => ({ env: { TWILIO_FROM_NUMBER: "+18885550000", APP_URL: "https://app.test" } }));

const { setClientSmsNumberAction } = await import("./sms-number");

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const submit = (smsNumber: string, clientId = CLIENT.id) =>
  setClientSmsNumberAction({}, form({ clientId, smsNumber }));

beforeEach(() => {
  operator = { id: "u-op", orgId: ORG };
  CLIENT.smsNumber = null;
  for (const f of [setClientSmsNumber, findOtherClientWithSmsNumber, checkTwilioNumber, audit, assertClientInOrg]) {
    f.mockClear();
  }
  findOtherClientWithSmsNumber.mockResolvedValue(null);
  checkTwilioNumber.mockResolvedValue({ ...okCheck });
});

describe("setClientSmsNumberAction", () => {
  it("is operator-only: business owners/staff are bounced before anything is read or written", async () => {
    operator = null;
    await expect(submit("+14155559999")).rejects.toThrow(/REDIRECT/);
    expect(assertClientInOrg).not.toHaveBeenCalled();
    expect(setClientSmsNumber).not.toHaveBeenCalled();
  });

  it("can't touch a business in another org", async () => {
    await expect(submit("+14155559999", "c-other")).rejects.toThrow(/not found/);
    expect(setClientSmsNumber).not.toHaveBeenCalled();
  });

  it("saves a verified number in E.164 and leaves a receipt", async () => {
    const r = await submit("(415) 555-9999");
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/\(415\) 555-9999/);
    expect(checkTwilioNumber).toHaveBeenCalledWith("+14155559999");
    expect(setClientSmsNumber).toHaveBeenCalledWith(ORG, CLIENT.id, "+14155559999");
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: CLIENT.id, action: "sms_number.assigned", actor: "u-op" }),
    );
  });

  it("warns (but saves) when the number's inbound webhook doesn't point at us", async () => {
    checkTwilioNumber.mockResolvedValue({ ...okCheck, webhookOk: false });
    const r = await submit("+14155559999");
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/https:\/\/app\.test\/api\/webhooks\/twilio/);
  });

  it("refuses junk, the shared number, a taken number, and one not in our Twilio", async () => {
    expect((await submit("555-0123")).fieldErrors?.smsNumber?.[0]).toMatch(/US\/Canada/);
    expect((await submit("(888) 555-0000")).fieldErrors?.smsNumber?.[0]).toMatch(/shared number/);

    findOtherClientWithSmsNumber.mockResolvedValueOnce({ id: "c2", name: "Bob's Plumbing" });
    expect((await submit("+14155559999")).fieldErrors?.smsNumber?.[0]).toMatch(/Bob's Plumbing/);

    checkTwilioNumber.mockResolvedValueOnce({ ...okCheck, found: false });
    expect((await submit("+14155559999")).fieldErrors?.smsNumber?.[0]).toMatch(/isn't in this Twilio account/);

    checkTwilioNumber.mockRejectedValueOnce(new Error("Twilio down"));
    expect((await submit("+14155559999")).error).toMatch(/Couldn't reach Twilio/);

    expect(setClientSmsNumber).not.toHaveBeenCalled();
  });

  it("empty input removes the number (back to the shared number)", async () => {
    CLIENT.smsNumber = "+14155559999";
    const r = await submit("");
    expect(r.ok).toBe(true);
    expect(setClientSmsNumber).toHaveBeenCalledWith(ORG, CLIENT.id, null);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "sms_number.removed" }));
    expect(checkTwilioNumber).not.toHaveBeenCalled();
  });
});
