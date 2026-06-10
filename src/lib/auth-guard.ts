import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients, organizations, users, type User } from "@/db/schema";

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
  if (existing) return existing;

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
      const viewer = (
        await db
          .insert(users)
          .values({
            orgId: client.orgId,
            clerkUserId: userId,
            email,
            role: "client_viewer",
            clientId: client.id,
          })
          .returning()
      )[0];
      if (viewer) return viewer;
    }
  }

  // Otherwise this is a self-serve signup. Each company gets its OWN isolated
  // workspace, keyed by email domain so teammates with the same company email
  // (e.g. two @acme.com employees) land in the SAME workspace. Free / consumer
  // domains are never grouped — each such signup gets its own workspace.
  // Only group by domain when we have a verified email; otherwise isolate (treat
  // it like a free-email signup that gets its own workspace).
  const domain = (verifiedEmail?.split("@")[1] ?? "").toLowerCase();
  const shareByDomain = domain.length > 0 && !FREE_EMAIL_DOMAINS.has(domain);

  let org = shareByDomain
    ? await db.query.organizations.findFirst({ where: eq(organizations.domain, domain) })
    : undefined;

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
    }
  }
  if (!org) throw new Error("Failed to bootstrap organization.");

  const created = (
    await db
      .insert(users)
      .values({ orgId: org.id, clerkUserId: userId, email, role: "operator" })
      .returning()
  )[0];
  if (!created) throw new Error("Failed to create user record.");
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
  if (!user.clientId) throw new Error("No client is assigned to this portal account.");
  return { clientId: user.clientId, preview: false };
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
