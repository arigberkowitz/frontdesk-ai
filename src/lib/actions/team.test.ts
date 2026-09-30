import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Team access (owner vs staff), end to end against a real in-process Postgres
 * with the full schema and the REAL auth guards. Only Clerk, cookies and the
 * outside world are stubbed — so no invite email is ever sent from a test.
 */

vi.mock("@/db", async () => (await import("../../../test/helpers/pglite-db")).pgliteDb());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/data/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "unlock-token" }), set: vi.fn() }),
}));
// Staff in these tests have entered the edit code: the point is that the code
// does NOT unlock owner-only settings.
vi.mock("@/lib/crypto", async (orig) => ({
  ...(await orig<typeof import("@/lib/crypto")>()),
  verifyUnlockToken: () => true,
}));
vi.mock("@/lib/data/clients", () => ({
  assertClientInOrg: vi.fn(async () => {}),
  getClient: vi.fn(async () => null),
  getClientByIdUnsafe: vi.fn(async () => null),
  updateClient: vi.fn(async () => {}),
}));
vi.mock("@/lib/agent-publish", () => ({
  applyClientEdit: vi.fn(async () => ({ ok: true })),
  syncAgentPrompt: vi.fn(async () => ({ ok: true })),
  withSyncNote: (m: string) => m,
}));
vi.mock("@/lib/notifier", () => ({ notifier: { sendEmail: vi.fn(), sendSms: vi.fn() } }));
vi.mock("@/lib/stripe", () => ({ getStripe: vi.fn() }));

// --- Clerk ------------------------------------------------------------------
let session: { userId: string | null } = { userId: null };
let clerkUserMeta: Record<string, unknown> = {};
const createInvitation = vi.fn(async (_p: unknown) => ({ id: "inv_new" }));
const getInvitationList = vi.fn(async (_p: unknown) => ({ data: [] as unknown[], totalCount: 0 }));
const revokeInvitation = vi.fn(async (_id: string) => ({}));
const getUserList = vi.fn(async (_p: unknown) => ({ data: [] as { id: string }[], totalCount: 0 }));
const updateUserMetadata = vi.fn(async (_id: string, _p: unknown) => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => session,
  currentUser: async () => ({
    emailAddresses: [{ emailAddress: "new@biz.test", verification: { status: "verified" } }],
    publicMetadata: clerkUserMeta,
  }),
  clerkClient: async () => ({
    invitations: { createInvitation, getInvitationList, revokeInvitation },
    users: { getUserList, updateUserMetadata },
  }),
}));

const { db } = await import("@/db");
const schema = await import("@/db/schema");
const team = await import("./team");
const { savePortalProfileAction } = await import("./portal");
const alerts = await import("./alert-contacts");
const { startSelfServeCheckoutAction } = await import("./billing");
const { requestTrialAction } = await import("./trial");
const { getCurrentDbUser, OWNER_ONLY_ERROR } = await import("@/lib/auth-guard");
const { eq } = await import("drizzle-orm");

const ORG = "00000000-0000-4000-8000-000000000001";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Role = "operator" | "client_admin" | "client_viewer";
async function addUser(email: string, role: Role, clientId: string | null) {
  const [u] = await db
    .insert(schema.users)
    .values({ orgId: ORG, clerkUserId: `clerk_${email}`, email, role, clientId })
    .returning();
  return u!;
}
function as(u: { clerkUserId: string | null }) {
  session = { userId: u.clerkUserId };
}
function fd(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
async function userRow(id: string) {
  return (await db.select().from(schema.users).where(eq(schema.users.id, id)))[0]!;
}

let owner: Awaited<ReturnType<typeof addUser>>;
let staff: Awaited<ReturnType<typeof addUser>>;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.CLERK_SECRET_KEY = "sk_test_x";
  clerkUserMeta = {};
  await db.delete(schema.alertContacts);
  await db.delete(schema.users);
  await db.delete(schema.clients);
  await db.delete(schema.organizations);
  await db.insert(schema.organizations).values({ id: ORG, name: "Agency", kind: "agency" });
  await db.insert(schema.clients).values([
    { id: A, orgId: ORG, name: "Acme Dental", editCodeHash: "set" },
    { id: B, orgId: ORG, name: "Other Biz" },
  ]);
  owner = await addUser("owner@acme.test", "client_admin", A);
  staff = await addUser("staff@acme.test", "client_viewer", A);
});

describe("invites", () => {
  it("owner invites staff through Clerk with the business + staff role in metadata", async () => {
    as(owner);
    const res = await team.inviteStaffAction({}, fd({ clientId: A, email: "New@Acme.test" }));
    expect(res.ok).toBe(true);
    expect(createInvitation).toHaveBeenCalledTimes(1);
    expect(createInvitation.mock.calls[0]![0]).toMatchObject({
      emailAddress: "new@acme.test",
      publicMetadata: { role: "client_viewer", clientId: A },
    });
  });

  it("owner can invite another owner", async () => {
    as(owner);
    await team.inviteStaffAction({}, fd({ clientId: A, email: "co@acme.test", role: "owner" }));
    expect(createInvitation.mock.calls[0]![0]).toMatchObject({
      publicMetadata: { role: "client_admin", clientId: A },
    });
  });

  it("staff cannot invite — refused on the server, Clerk never called", async () => {
    as(staff);
    const res = await team.inviteStaffAction({}, fd({ clientId: A, email: "x@acme.test" }));
    expect(res.ok).toBe(false);
    expect(createInvitation).not.toHaveBeenCalled();
    expect(updateUserMetadata).not.toHaveBeenCalled();
  });

  it("an owner cannot invite into another business", async () => {
    as(owner);
    const res = await team.inviteStaffAction({}, fd({ clientId: B, email: "x@acme.test" }));
    expect(res.ok).toBe(false);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("refuses an email that already has a live login", async () => {
    as(owner);
    const res = await team.inviteStaffAction({}, fd({ clientId: A, email: "STAFF@acme.test" }));
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toMatch(/already on your team/);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("an existing Clerk account without a login row is attached via metadata, not a new invite", async () => {
    getUserList.mockResolvedValueOnce({ data: [{ id: "user_old" }], totalCount: 1 });
    as(owner);
    const res = await team.inviteStaffAction({}, fd({ clientId: A, email: "back@acme.test" }));
    expect(res.ok).toBe(true);
    expect(createInvitation).not.toHaveBeenCalled();
    expect(updateUserMetadata).toHaveBeenCalledWith("user_old", {
      publicMetadata: { role: "client_viewer", clientId: A },
    });
  });

  it("says invites are off when Clerk isn't configured", async () => {
    delete process.env.CLERK_SECRET_KEY;
    as(owner);
    const res = await team.inviteStaffAction({}, fd({ clientId: A, email: "x@acme.test" }));
    expect(res.ok).toBe(false);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("revoke only touches this business's invitations", async () => {
    getInvitationList.mockResolvedValue({
      data: [
        {
          id: "inv_a",
          emailAddress: "a@x",
          publicMetadata: { clientId: A, role: "client_viewer" },
          createdAt: 1,
        },
        {
          id: "inv_b",
          emailAddress: "b@x",
          publicMetadata: { clientId: B, role: "client_viewer" },
          createdAt: 1,
        },
      ],
      totalCount: 2,
    });
    as(owner);
    const other = await team.revokeInviteAction({}, fd({ clientId: A, invitationId: "inv_b" }));
    expect(other.ok).toBe(false);
    expect(revokeInvitation).not.toHaveBeenCalled();
    const mine = await team.revokeInviteAction({}, fd({ clientId: A, invitationId: "inv_a" }));
    expect(mine.ok).toBe(true);
    expect(revokeInvitation).toHaveBeenCalledWith("inv_a");

    as(staff);
    const byStaff = await team.revokeInviteAction({}, fd({ clientId: A, invitationId: "inv_a" }));
    expect(byStaff.ok).toBe(false);
    expect(revokeInvitation).toHaveBeenCalledTimes(1);
  });
});

describe("roles and removal", () => {
  it("owner promotes staff; the business can never drop to zero owners", async () => {
    as(owner);
    const demoteSelf = await team.setMemberRoleAction(
      {},
      fd({ clientId: A, userId: owner.id, role: "staff" }),
    );
    expect(demoteSelf.ok).toBe(false);
    expect((await userRow(owner.id)).role).toBe("client_admin");

    const promote = await team.setMemberRoleAction(
      {},
      fd({ clientId: A, userId: staff.id, role: "owner" }),
    );
    expect(promote.ok).toBe(true);
    expect((await userRow(staff.id)).role).toBe("client_admin");

    // Two owners now — stepping down is fine.
    const stepDown = await team.setMemberRoleAction(
      {},
      fd({ clientId: A, userId: owner.id, role: "staff" }),
    );
    expect(stepDown.ok).toBe(true);
    expect((await userRow(owner.id)).role).toBe("client_viewer");
  });

  it("staff cannot change roles (including their own)", async () => {
    as(staff);
    const res = await team.setMemberRoleAction(
      {},
      fd({ clientId: A, userId: staff.id, role: "owner" }),
    );
    expect(res.ok).toBe(false);
    expect((await userRow(staff.id)).role).toBe("client_viewer");
  });

  it("can't act on a member of another business", async () => {
    const outsider = await addUser("o@other.test", "client_viewer", B);
    as(owner);
    const r1 = await team.setMemberRoleAction(
      {},
      fd({ clientId: A, userId: outsider.id, role: "owner" }),
    );
    const r2 = await team.removeMemberAction({}, fd({ clientId: A, userId: outsider.id }));
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect((await userRow(outsider.id)).deletedAt).toBeNull();
  });

  it("removing a member clears their Clerk membership first, then revokes access", async () => {
    as(owner);
    const res = await team.removeMemberAction({}, fd({ clientId: A, userId: staff.id }));
    expect(res.ok).toBe(true);
    expect(updateUserMetadata).toHaveBeenCalledWith("clerk_staff@acme.test", {
      publicMetadata: { role: null, clientId: null },
    });
    const row = await userRow(staff.id);
    expect(row.deletedAt).not.toBeNull();
    expect(row.clerkUserId).toBeNull();
  });

  it("if Clerk can't be updated, the member is NOT removed (no half state)", async () => {
    updateUserMetadata.mockRejectedValueOnce(new Error("clerk down"));
    as(owner);
    const res = await team.removeMemberAction({}, fd({ clientId: A, userId: staff.id }));
    expect(res.ok).toBe(false);
    expect((await userRow(staff.id)).deletedAt).toBeNull();
  });

  it("the only owner can't be removed; staff can't remove anyone", async () => {
    as(owner);
    expect((await team.removeMemberAction({}, fd({ clientId: A, userId: owner.id }))).ok).toBe(
      false,
    );
    as(staff);
    expect((await team.removeMemberAction({}, fd({ clientId: A, userId: owner.id }))).ok).toBe(
      false,
    );
    expect((await userRow(owner.id)).deletedAt).toBeNull();
  });

  it("an agency operator can fix things up, even demoting the last owner", async () => {
    const op = await addUser("op@agency.test", "operator", null);
    as(op);
    const res = await team.setMemberRoleAction(
      {},
      fd({ clientId: A, userId: owner.id, role: "staff" }),
    );
    expect(res.ok).toBe(true);
  });

  it("a removed member's next sign-in doesn't resurrect the membership", async () => {
    as(owner);
    await team.removeMemberAction({}, fd({ clientId: A, userId: staff.id }));
    // Clerk metadata was cleared, so the returning user carries none.
    clerkUserMeta = {};
    session = { userId: "clerk_staff@acme.test" };
    const again = await getCurrentDbUser();
    expect(again.clientId).toBeNull();
  });
});

describe("owner-only settings are enforced on the server (staff with the edit code)", () => {
  it("staff can't change the alert email / phone / SMS alerts / weekly summary", async () => {
    as(staff);
    for (const field of ["ownerEmail", "alertPhone", "smsAlertsEnabled", "weeklySummaryEnabled"]) {
      const res = await savePortalProfileAction({}, fd({ clientId: A, [field]: "x" }));
      expect(res).toEqual({ ok: false, error: OWNER_ONLY_ERROR });
    }
  });

  it("staff with the code can still save everyday profile fields", async () => {
    as(staff);
    const res = await savePortalProfileAction({}, fd({ clientId: A, name: "Acme Dental & Co" }));
    expect(res.ok).toBe(true);
  });

  it("owner can turn the weekly summary email off", async () => {
    as(owner);
    const res = await savePortalProfileAction({}, fd({ clientId: A, weeklySummaryEnabled: "off" }));
    expect(res.ok).toBe(true);
  });

  it("owner can change the alert phone", async () => {
    as(owner);
    const res = await savePortalProfileAction({}, fd({ clientId: A, alertPhone: "+14155550100" }));
    expect(res.ok).toBe(true);
  });

  it("staff can't add or remove alert roster people, but can flip who's on duty", async () => {
    as(staff);
    await alerts.addAlertContactAction(fd({ clientId: A, name: "Sam", phone: "+14155550199" }));
    expect(await db.select().from(schema.alertContacts)).toHaveLength(0);

    as(owner);
    await alerts.addAlertContactAction(fd({ clientId: A, name: "Sam", phone: "+14155550199" }));
    const [c] = await db.select().from(schema.alertContacts);
    expect(c).toBeTruthy();

    as(staff);
    await alerts.toggleAlertContactAction(fd({ clientId: A, contactId: c!.id, onDuty: "false" }));
    expect((await db.select().from(schema.alertContacts))[0]!.onDuty).toBe(false);
    await alerts.deleteAlertContactAction(fd({ clientId: A, contactId: c!.id }));
    expect(await db.select().from(schema.alertContacts)).toHaveLength(1);
  });

  it("staff can't start a billing checkout or redeem a trial code", async () => {
    as(staff);
    expect(await startSelfServeCheckoutAction({}, fd({ clientId: A, plan: "starter" }))).toEqual({
      ok: false,
      error: OWNER_ONLY_ERROR,
    });
    expect(await requestTrialAction({}, fd({ clientId: A, code: "FD-XXXX" }))).toEqual({
      ok: false,
      error: OWNER_ONLY_ERROR,
    });
  });
});

describe("sign-up from an invite", () => {
  it("an owner invite creates an owner even when the business already has one", async () => {
    clerkUserMeta = { role: "client_admin", clientId: A };
    session = { userId: "clerk_new_owner" };
    const u = await getCurrentDbUser();
    expect(u).toMatchObject({ role: "client_admin", clientId: A });
  });

  it("a staff invite creates staff once an owner exists", async () => {
    clerkUserMeta = { role: "client_viewer", clientId: A };
    session = { userId: "clerk_new_staff" };
    const u = await getCurrentDbUser();
    expect(u).toMatchObject({ role: "client_viewer", clientId: A });
  });

  it("an unknown role in metadata grants nothing", async () => {
    clerkUserMeta = { role: "operator", clientId: A };
    session = { userId: "clerk_sneaky" };
    const u = await getCurrentDbUser();
    expect(u.clientId).toBeNull();
    expect(u.role).not.toBe("operator");
  });
});
