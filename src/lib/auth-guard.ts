import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { alertContacts, clients, organizations, users, type User } from "@/db/schema";

/**
 * Auth + tenant-isolation helpers (§12, §17). Every server entry point into
 * tenant data should go through one of these so a client_viewer can never read
 * another client's rows — enforced here, not just in the UI.
 */

/**
 * Free / consumer email providers. Signups from these are NEVER grouped by
 * domain (everyone with @gmail.com is not the same company) — each gets its own
 * isolated workspace. A custom company domain (e.g. acme.com) IS grouped, so
 * teammates share one workspace.
 */
const FREE_EMAIL_DOMAINS = new Set(
  (
    "gmail.com googlemail.com icloud.com me.com mac.com outlook.com hotmail.com " +
    "live.com msn.com windowslive.com outlook.fr outlook.de outlook.es outlook.com.br " +
    "outlook.com.au hotmail.co.uk hotmail.fr hotmail.de hotmail.es hotmail.it " +
    "hotmail.com.br live.co.uk live.fr live.de live.ca live.com.au live.nl yahoo.com " +
    "ymail.com rocketmail.com yahoo.co.uk yahoo.ca yahoo.fr yahoo.de yahoo.es yahoo.it " +
    "yahoo.com.br yahoo.com.au yahoo.co.in yahoo.co.jp yahoo.com.mx aol.com aim.com " +
    "proton.me protonmail.com protonmail.ch pm.me tutanota.com tuta.com duck.com " +
    "hushmail.com posteo.de mailbox.org gmx.com gmx.net gmx.de web.de mail.com email.com " +
    "zoho.com yandex.com yandex.ru ya.ru fastmail.com fastmail.fm hey.com comcast.net " +
    "verizon.net att.net sbcglobal.net bellsouth.net cox.net charter.net earthlink.net " +
    "optonline.net juno.com netzero.net frontier.com frontiernet.net rr.com roadrunner.com " +
    "windstream.net centurylink.net btinternet.com ntlworld.com talktalk.net sky.com " +
    "virginmedia.com blueyonder.co.uk orange.fr wanadoo.fr free.fr sfr.fr laposte.net " +
    "libero.it virgilio.it alice.it tin.it tiscali.it t-online.de freenet.de telenet.be " +
    "ziggo.nl home.nl bluewin.ch sapo.pt seznam.cz centrum.cz wp.pl o2.pl interia.pl " +
    "onet.pl abv.bg mail.ru bk.ru inbox.ru list.ru internet.ru rambler.ru qq.com 163.com " +
    "126.com sina.com sina.cn sohu.com foxmail.com naver.com hanmail.net daum.net nate.com " +
    "rediffmail.com sify.com"
  ).split(" "),
);

/** A friendly starting name for a freshly-bootstrapped workspace. */
function deriveWorkspaceName(domain: string, email: string): string {
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) {
    const local = (email.split("@")[0] || "").replace(/[._-]+/g, " ").trim();
    return local ? `${local}'s workspace` : "My workspace";
  }
  const base = domain.split(".")[0] || domain;
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Cheap check that a Clerk session exists; redirects to sign-in otherwise. */
export async function requireAuth(): Promise<{ clerkUserId: string }> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return { clerkUserId: userId };
}

/**
 * The platform owner(s) always govern from an *agency* workspace (full admin +
 * the cross-workspace Platform view). If a super-admin's workspace was created as
 * a self-serve "business" (e.g. they signed up like any other user), upgrade it
 * to "agency" so they land on the governing dashboard. Idempotent — the WHERE
 * clause makes it a no-op once the workspace is already an agency.
 */
async function ensureSuperAdminGoverns(user: User): Promise<void> {
  if (!SUPER_ADMIN_EMAILS.has(user.email.toLowerCase())) return;
  await db
    .update(organizations)
    .set({ kind: "agency" })
    .where(and(eq(organizations.id, user.orgId), ne(organizations.kind, "agency")));
}

/**
 * Resolve the Clerk-authenticated user to our `users` row, bootstrapping it (and
 * a default agency org) on first login. Single-operator v1: the first user
 * creates the org as `operator`; subsequent operators join the existing org.
 */
export async function getCurrentDbUser(): Promise<User> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const existing = await db.query.users.findFirst({
    where: and(eq(users.clerkUserId, userId), isNull(users.deletedAt)),
  });
  if (existing) {
    await ensureSuperAdminGoverns(existing);
    return existing;
  }

  const cu = await currentUser();
  // The org you join is decided by your email DOMAIN, so it must come from a
  // *verified* address — never an unverified one a stranger could attach.
  const verifiedEmail =
    cu?.emailAddresses?.find((e) => e.verification?.status === "verified")?.emailAddress ?? null;
  const email =
    verifiedEmail ??
    cu?.primaryEmailAddress?.emailAddress ??
    cu?.emailAddresses?.[0]?.emailAddress ??
    "";
  const meta = (cu?.publicMetadata ?? {}) as { role?: string; clientId?: string };

  // Invited client viewer — Clerk publicMetadata carries { role, clientId }.
  if (meta.role === "client_viewer" && meta.clientId) {
    const client = await db.query.clients.findFirst({
      where: and(eq(clients.id, meta.clientId), isNull(clients.deletedAt)),
    });
    if (client) {
      // The FIRST portal user for a business is its admin (the owner); later
      // invites are staff, who edit only after unlocking with the admin's code.
      const existingAdmin = await db.query.users.findFirst({
        where: and(
          eq(users.clientId, client.id),
          eq(users.role, "client_admin"),
          isNull(users.deletedAt),
        ),
      });
      const viewer = (
        await db
          .insert(users)
          .values({
            orgId: client.orgId,
            clerkUserId: userId,
            email,
            role: existingAdmin ? "client_viewer" : "client_admin",
            clientId: client.id,
          })
          .returning()
      )[0];
      if (viewer) return viewer;
    }
  }

  // Self-serve signup → they become a CLIENT of the house agency, not their own
  // isolated workspace: the user lands in the platform's agency org as a
  // client_admin with no business yet (the /welcome flow creates it), so every
  // signup shows up on the operator's dashboard. Tenant isolation still holds —
  // portal users only ever see their own client's data.
  // The operator can switch this off (Settings → Signups), in which case new
  // signups fall through to the isolated-workspace path below.
  const houseOrg = await db.query.organizations.findFirst({
    where: eq(organizations.kind, "agency"),
    orderBy: (o, { asc }) => [asc(o.createdAt)],
  });
  if (houseOrg && houseOrg.autoAttachSignups) {
    const member = (
      await db
        .insert(users)
        .values({ orgId: houseOrg.id, clerkUserId: userId, email, role: "client_admin" })
        .onConflictDoNothing({ target: users.clerkUserId })
        .returning()
    )[0];
    const resolved =
      member ??
      (await db.query.users.findFirst({
        where: and(eq(users.clerkUserId, userId), isNull(users.deletedAt)),
      }));
    if (!resolved) throw new Error("Failed to create user record.");
    return resolved;
  }

  // Fresh-install fallback (no agency org exists yet): the first signup
  // bootstraps their own workspace — this is how the platform owner's own
  // account came to be.
  const domain = (verifiedEmail?.split("@")[1] ?? "").toLowerCase();
  const shareByDomain = domain.length > 0 && !FREE_EMAIL_DOMAINS.has(domain);

  let org = shareByDomain
    ? await db.query.organizations.findFirst({ where: eq(organizations.domain, domain) })
    : undefined;

  // Track whether *this* call freshly created a private (free-email) workspace, so
  // we know it's safe to remove if we then lose the user-insert race below.
  let createdFreeOrg = false;
  if (!org) {
    const name = deriveWorkspaceName(domain, email);
    if (shareByDomain) {
      // Insert-or-get so two teammates signing up at the same moment don't race
      // into two separate workspaces for the same domain.
      await db
        .insert(organizations)
        .values({ name, domain })
        .onConflictDoNothing({ target: organizations.domain });
      org = await db.query.organizations.findFirst({ where: eq(organizations.domain, domain) });
    } else {
      org = (await db.insert(organizations).values({ name, domain: null }).returning())[0];
      createdFreeOrg = true;
    }
  }
  if (!org) throw new Error("Failed to bootstrap organization.");

  // Insert the user, tolerating a first-login race: if two requests bootstrap the
  // same Clerk user at once, the unique clerk_user_id index lets only one win.
  // The loser would otherwise leave its just-created workspace orphaned with zero
  // members — so delete that orphan and fall back to the winner's workspace.
  let created: User | undefined = (
    await db
      .insert(users)
      .values({ orgId: org.id, clerkUserId: userId, email, role: "operator" })
      .onConflictDoNothing({ target: users.clerkUserId })
      .returning()
  )[0];

  if (!created) {
    if (createdFreeOrg) {
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
    created = await db.query.users.findFirst({
      where: and(eq(users.clerkUserId, userId), isNull(users.deletedAt)),
    });
  }
  if (!created) throw new Error("Failed to create user record.");
  await ensureSuperAdminGoverns(created);
  return created;
}

/**
 * Non-redirecting lookup for route handlers / downloads. Returns null instead of
 * redirecting, so the caller can respond with a 401.
 */
export async function getCurrentDbUserSafe(): Promise<User | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const row = await db.query.users.findFirst({
    where: and(eq(users.clerkUserId, userId), isNull(users.deletedAt)),
  });
  return row ?? null;
}

/** Require an operator (agency admin). Client viewers are sent to their portal. */
export async function requireOperator(): Promise<User> {
  const user = await getCurrentDbUser();
  if (user.role !== "operator") redirect("/portal");
  return user;
}

/** Fetch the organization row for a user's org. */
async function getOrg(orgId: string) {
  return db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
}

/**
 * Require an operator of an *agency* workspace (the full multi-client admin).
 * Self-serve business owners and client viewers are routed to their own portal.
 */
export async function requireAgencyOperator(): Promise<User> {
  const user = await getCurrentDbUser();
  if (user.role !== "operator") redirect("/portal");
  const org = await getOrg(user.orgId);
  if (org?.kind !== "agency") redirect("/portal");
  return user;
}

/** Where a resolved user should land: the agency admin vs. their own portal. */
export async function operatorHomePath(user: User): Promise<string> {
  if (user.role !== "operator") return "/portal";
  const org = await getOrg(user.orgId);
  return org?.kind === "agency" ? "/dashboard" : "/portal";
}

/** Platform owner(s) who can see every workspace on the platform (oversight). */
const SUPER_ADMIN_EMAILS = new Set(
  (process.env.SUPER_ADMIN_EMAILS ?? "arigberkowitz@gmail.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

export function isSuperAdmin(user: User): boolean {
  return SUPER_ADMIN_EMAILS.has(user.email.toLowerCase());
}

/** Require a platform super-admin (the only role that sees across all workspaces). */
export async function requireSuperAdmin(): Promise<User> {
  const user = await getCurrentDbUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");
  return user;
}

/** Require a client viewer scoped to one client; operators go to the dashboard. */
export async function requireClientViewer(): Promise<User & { clientId: string }> {
  const user = await getCurrentDbUser();
  if (user.role === "operator") redirect("/dashboard");
  if (!user.clientId) throw new Error("No client is assigned to this portal account.");
  return user as User & { clientId: string };
}

/** Cookie carrying the client an operator is currently previewing in the portal. */
export const PORTAL_PREVIEW_COOKIE = "fdai_portal_preview";

/**
 * Resolve whose data the /portal should render.
 * - A `client_viewer` always sees their own client.
 * - An `operator` may *preview* any client in their org — set via the
 *   `/clients/[id]/preview-portal` entry point and carried in a cookie — so they
 *   can see exactly what a client sees without a second login. The org check here
 *   means an operator can never preview a client outside their own agency.
 */
export async function resolvePortalClient(): Promise<{ clientId: string; preview: boolean }> {
  const user = await getCurrentDbUser();
  if (user.role === "operator") {
    const org = await getOrg(user.orgId);
    if (org?.kind === "business") {
      // Self-serve business owner: show their own business (the first / only one).
      // With no business yet, send them to the guided setup.
      const own = await db.query.clients.findFirst({
        where: and(eq(clients.orgId, user.orgId), isNull(clients.deletedAt)),
        orderBy: (c, { asc }) => [asc(c.createdAt)],
      });
      if (!own) redirect("/welcome");
      return { clientId: own.id, preview: false };
    }
    const jar = await cookies();
    const previewId = jar.get(PORTAL_PREVIEW_COOKIE)?.value;
    if (!previewId) redirect("/dashboard");
    const client = await db.query.clients.findFirst({
      where: and(eq(clients.id, previewId), eq(clients.orgId, user.orgId), isNull(clients.deletedAt)),
    });
    if (!client) redirect("/dashboard");
    return { clientId: previewId, preview: true };
  }
  // A signup that hasn't created their business yet → guided setup.
  if (!user.clientId) redirect("/welcome");
  return { clientId: user.clientId, preview: false };
}

/**
 * Who may create a business in the /welcome flow: operators (any client) or a
 * fresh signup (client_admin not yet attached to a business).
 */
export async function requireBusinessCreator(): Promise<User> {
  const user = await getCurrentDbUser();
  if (user.role === "operator") return user;
  if (user.role === "client_admin" && !user.clientId) return user;
  redirect("/portal");
}

/** After a signup creates their business, bind their account to it. */
export async function attachCreatorToClient(user: User, clientId: string): Promise<void> {
  if (user.role === "operator") return;
  await db.update(users).set({ clientId }).where(eq(users.id, user.id));

  // The creator is the owner: pre-fill where alerts go so nothing starts
  // empty. Their email becomes the owner contact AND the first on-duty person
  // on the alert roster — both editable later in portal Settings.
  const email = user.email?.trim();
  if (!email) return;
  const ownerName = email.split("@")[0] || "Owner";
  await db
    .update(clients)
    .set({ ownerEmail: email })
    .where(and(eq(clients.id, clientId), isNull(clients.ownerEmail)));
  await db
    .insert(alertContacts)
    .values({ clientId, name: ownerName, email, onDuty: true })
    .onConflictDoNothing();
}

/**
 * Tenant guard (§12): operators may access any client; a client_viewer may only
 * touch their own `client_id`. Throws on a cross-tenant attempt.
 */
export async function assertClientAccess(clientId: string): Promise<User> {
  const user = await getCurrentDbUser();
  if (user.role === "operator") return user;
  if (user.clientId !== clientId) {
    throw new Error("Forbidden: cross-tenant access denied.");
  }
  return user;
}

/* ------------------------- portal edit permissions ------------------------ */

const editUnlockCookie = (clientId: string) => `fdai_edit_${clientId}`;

export interface PortalEditAccess {
  canEdit: boolean;
  isAdmin: boolean;
  /** Whether the admin has set an edit code at all (drives the staff banner copy). */
  hasCode: boolean;
}

/** What the current portal user may do with this client's AI configuration. */
export async function getPortalEditAccess(clientId: string): Promise<PortalEditAccess> {
  const user = await assertClientAccess(clientId);
  if (user.role === "operator" || user.role === "client_admin") {
    return { canEdit: true, isAdmin: true, hasCode: true };
  }
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), isNull(clients.deletedAt)),
    columns: { editCodeHash: true },
  });
  const hasCode = Boolean(client?.editCodeHash);
  if (!hasCode) return { canEdit: false, isAdmin: false, hasCode: false };
  const { verifyUnlockToken } = await import("./crypto");
  const jar = await cookies();
  const unlocked = verifyUnlockToken(jar.get(editUnlockCookie(clientId))?.value, clientId, user.id);
  return { canEdit: unlocked, isAdmin: false, hasCode: true };
}

/**
 * Editing guard for anything that shapes the live AI (knowledge, services,
 * hours, greeting, guidance, settings, suggestion approvals). Operators and
 * client admins pass; staff pass only with a valid unlock cookie.
 */
export async function assertClientEditor(clientId: string): Promise<User> {
  const user = await assertClientAccess(clientId);
  if (user.role === "operator" || user.role === "client_admin") return user;
  const access = await getPortalEditAccess(clientId);
  if (!access.canEdit) {
    throw new Error(
      access.hasCode
        ? "Editing is locked — enter your business's edit code to unlock."
        : "Editing is limited to your admin.",
    );
  }
  return user;
}

/** Set the unlock cookie after a correct code entry (12h, per client+user). */
export async function grantEditUnlock(clientId: string, userId: string): Promise<void> {
  const { signUnlockToken } = await import("./crypto");
  const jar = await cookies();
  jar.set(editUnlockCookie(clientId), signUnlockToken(clientId, userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60,
    path: "/",
  });
}
