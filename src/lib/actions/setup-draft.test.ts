import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Fill in for me" endpoint: only people who may edit the business get a draft,
 * it reads (never writes), it's built from the business's own setup, and it's
 * rate limited per person.
 */
const requireClientEditor = vi.fn();
const getClient = vi.fn();
const isConfigured = vi.fn();
const updateClient = vi.fn();

vi.mock("@/lib/auth-guard", () => ({
  requireClientEditor: (...a: unknown[]) => requireClientEditor(...a),
}));
vi.mock("@/lib/data/clients", () => ({
  getClient: (...a: unknown[]) => getClient(...a),
  updateClient: (...a: unknown[]) => updateClient(...a),
}));
vi.mock("@/lib/booking", () => ({
  getBookingProviderForClient: () => ({ isConfigured: () => isConfigured() }),
}));

const { draftSetupTextAction } = await import("./setup-draft");
const { clearAttempts } = await import("@/lib/rate-limit");

let userSeq = 0;
function signIn() {
  const user = { id: `user-${++userSeq}`, orgId: "org1", role: "client_admin" };
  requireClientEditor.mockResolvedValue({ ok: true, user });
  return user;
}

const client = {
  id: "c1",
  name: "Bright Smile Dental",
  industry: "Dental",
  agentName: null,
  languages: "en-es",
  escalationNumber: "+14155550100",
  humanHandoffEnabled: true,
  setupFlags: {},
  services: [
    { name: "Cleaning & checkup", isActive: true, priceCents: null },
    { name: "Old service", isActive: false, priceCents: 9900 },
  ],
  businessHours: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek,
    isClosed: false,
    openTime: "09:00",
    closeTime: "17:00",
  })),
};

beforeEach(() => {
  vi.clearAllMocks();
  getClient.mockResolvedValue(client);
  isConfigured.mockReturnValue(false);
});

describe("draftSetupTextAction", () => {
  it("writes the draft from this business's own setup, and saves nothing", async () => {
    signIn();
    const r = await draftSetupTextAction({ clientId: "c1", field: "bookingInstructions" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("Book these services: Cleaning & checkup.");
    expect(r.text).not.toContain("Old service");
    expect(r.text).toContain("Mon–Fri 9 AM–5 PM");
    expect(r.text).toContain("calendar isn't connected");
    expect(r.text).toContain("new or returning patient");
    expect(updateClient).not.toHaveBeenCalled();
  });

  it("reflects a connected calendar and the languages", async () => {
    signIn();
    isConfigured.mockReturnValue(true);
    const r = await draftSetupTextAction({ clientId: "c1", field: "bookingInstructions" });
    expect(r.ok && r.text).toContain("Offer the next open times on the calendar.");
    expect(r.ok && r.text).toContain("Read the booking back in the language");
  });

  it("looks the business up inside the caller's own organization", async () => {
    const user = signIn();
    await draftSetupTextAction({ clientId: "c1", field: "greeting" });
    expect(requireClientEditor).toHaveBeenCalledWith("c1");
    expect(getClient).toHaveBeenCalledWith(user.orgId, "c1");
  });

  it("drafts a greeting and a service description", async () => {
    signIn();
    const g = await draftSetupTextAction({ clientId: "c1", field: "greeting" });
    expect(g.ok && g.text).toContain("Bright Smile Dental");
    const d = await draftSetupTextAction({
      clientId: "c1",
      field: "serviceDescription",
      serviceName: "Teeth whitening",
    });
    expect(d.ok && d.text).toMatch(/whitening/);
    const miss = await draftSetupTextAction({
      clientId: "c1",
      field: "serviceDescription",
      serviceName: "Something unusual",
    });
    expect(miss).toMatchObject({ ok: false });
  });

  it("refuses people who can't edit this business, without touching the database", async () => {
    requireClientEditor.mockResolvedValue({ ok: false, error: "Editing is limited to your admin." });
    const r = await draftSetupTextAction({ clientId: "c1", field: "greeting" });
    expect(r).toEqual({ ok: false, error: "Editing is limited to your admin." });
    expect(getClient).not.toHaveBeenCalled();
  });

  it("rejects a box it can't fill, before checking anything", async () => {
    const r = await draftSetupTextAction({ clientId: "c1", field: "knowledgeAnswer" });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/can't be filled/) });
    expect(requireClientEditor).not.toHaveBeenCalled();
  });

  it("says so when the business isn't found", async () => {
    signIn();
    getClient.mockResolvedValue(undefined);
    expect(await draftSetupTextAction({ clientId: "nope", field: "greeting" })).toEqual({
      ok: false,
      error: "Business not found.",
    });
  });

  it("fails soft: a database error becomes a friendly message, not a crash", async () => {
    signIn();
    getClient.mockRejectedValue(new Error("connection reset"));
    const r = await draftSetupTextAction({ clientId: "c1", field: "greeting" });
    expect(r).toEqual({
      ok: false,
      error: "We couldn't write a suggestion just now. Try again in a moment.",
    });
  });

  it("rate limits one person, not everyone", async () => {
    const user = signIn();
    for (let i = 0; i < 40; i++) {
      const r = await draftSetupTextAction({ clientId: "c1", field: "greeting" });
      expect(r.ok).toBe(true);
    }
    const blocked = await draftSetupTextAction({ clientId: "c1", field: "greeting" });
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/Try again in/) });
    // Someone else is unaffected.
    signIn();
    expect((await draftSetupTextAction({ clientId: "c1", field: "greeting" })).ok).toBe(true);
    clearAttempts(`setup-draft:${user.id}`);
  });
});
