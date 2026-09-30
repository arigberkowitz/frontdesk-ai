import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { env } from "@/lib/env";
import { teamRoleToDb, type TeamRole } from "@/lib/team-rules";

/**
 * The only place the portal talks to Clerk about team membership. Membership
 * rides on Clerk `publicMetadata` = { role, clientId }: an invitation carries it
 * into the new account, and `getCurrentDbUser` turns it into a `users` row on
 * first sign-in. Clerk sends the invite email — we never send one ourselves.
 *
 * Everything here needs CLERK_SECRET_KEY; callers check `teamInvitesReady()`.
 */

export function teamInvitesReady(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}

export interface PendingInvite {
  id: string;
  email: string;
  role: TeamRole;
  createdAt: number;
}

function metaFor(clientId: string, role: TeamRole) {
  return { role: teamRoleToDb(role), clientId };
}

/**
 * Invite someone by email. If that email already has a Clerk sign-in (e.g. a
 * person removed earlier, or who signed up and never built a business), an
 * invitation wouldn't attach them — Clerk only copies invitation metadata into
 * NEW accounts — so we set the membership on their account directly and they
 * join the next time they sign in.
 */
export async function inviteTeamMember(args: {
  clientId: string;
  email: string;
  role: TeamRole;
}): Promise<{ kind: "invited" | "existing_account" }> {
  const clerk = await clerkClient();
  const existing = await clerk.users.getUserList({ emailAddress: [args.email], limit: 1 });
  const account = existing.data[0];
  if (account) {
    await clerk.users.updateUserMetadata(account.id, {
      publicMetadata: metaFor(args.clientId, args.role),
    });
    return { kind: "existing_account" };
  }
  await clerk.invitations.createInvitation({
    emailAddress: args.email,
    publicMetadata: metaFor(args.clientId, args.role),
    redirectUrl: `${env.APP_URL}/portal`,
    ignoreExisting: true,
  });
  return { kind: "invited" };
}

/** Pending invitations for THIS business only. */
export async function listPendingInvites(clientId: string): Promise<PendingInvite[]> {
  const clerk = await clerkClient();
  const res = await clerk.invitations.getInvitationList({ status: "pending", limit: 500 });
  return res.data
    .filter((i) => (i.publicMetadata as { clientId?: unknown } | null)?.clientId === clientId)
    .map((i) => ({
      id: i.id,
      email: i.emailAddress,
      role:
        (i.publicMetadata as { role?: unknown } | null)?.role === "client_admin"
          ? "owner"
          : "staff",
      createdAt: i.createdAt,
    }));
}

/**
 * Revoke an invitation — only if it belongs to this business. Returns false
 * for an id that's someone else's (or already gone), so one tenant can never
 * cancel another tenant's invite by guessing ids.
 */
export async function revokePendingInvite(
  clientId: string,
  invitationId: string,
): Promise<boolean> {
  const mine = await listPendingInvites(clientId);
  if (!mine.some((i) => i.id === invitationId)) return false;
  const clerk = await clerkClient();
  await clerk.invitations.revokeInvitation(invitationId);
  return true;
}

/**
 * Strip team membership off a Clerk account (used on removal). Without this
 * the leftover { role, clientId } would re-create the membership the next
 * time they sign in. Setting a key to null deletes it in Clerk's merge.
 */
export async function clearClerkMembership(clerkUserId: string): Promise<void> {
  const clerk = await clerkClient();
  await clerk.users.updateUserMetadata(clerkUserId, {
    publicMetadata: { role: null, clientId: null },
  });
}
