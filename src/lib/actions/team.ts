"use server";

import { revalidatePath } from "next/cache";
import { and, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireClientOwner } from "@/lib/auth-guard";
import { assertClientInOrg } from "@/lib/data/clients";
import { audit } from "@/lib/data/audit";
import { countOwners, getTeamMember, removeMember, setMemberRole } from "@/lib/data/team";
import {
  clearClerkMembership,
  inviteTeamMember,
  revokePendingInvite,
  teamInvitesReady,
} from "@/lib/team-invites";
import { parseTeamRole, teamRoleToDb, wouldOrphanBusiness } from "@/lib/team-rules";
import { logger } from "@/lib/logger";
import { type ActionState } from "./types";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TEAM_PATH = "/portal/settings/team";
const NOT_READY = "Team invites aren't switched on yet — contact support.";

/**
 * Owner-only guard shared by every team action: the caller must be this
 * business's owner (or its operator) AND, for operators, the client must be
 * in their org. Staff are refused on the server whatever the UI shows.
 */
async function ownerGuard(clientId: string) {
  const guard = await requireClientOwner(clientId);
  if (!guard.ok) return guard;
  await assertClientInOrg(guard.user.orgId, clientId);
  return guard;
}

/**
 * Invite a teammate by email as staff (default) or owner. Clerk sends the
 * email; the invitee signs up from the link and lands in this business with
 * that role. Staff see and work calls, appointments and messages; owners also
 * manage billing, the team and alert settings.
 */
export async function inviteStaffAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = parseTeamRole(formData.get("role") ?? "staff");

  const guard = await ownerGuard(clientId);
  if (!guard.ok) return { ok: false, error: "Only the business owner can invite team members." };
  if (!EMAIL_RE.test(email)) {
    return { ok: false, fieldErrors: { email: ["Enter a valid email"] } };
  }
  if (!role) return { ok: false, fieldErrors: { role: ["Pick owner or staff"] } };
  if (!teamInvitesReady()) return { ok: false, error: NOT_READY };

  // Someone with a live FrontDesk login can't be pulled into a second business
  // (a login belongs to exactly one) — say so rather than "sent" and nothing.
  const live = await db.query.users.findFirst({
    where: and(sql`lower(${users.email}) = ${email}`, isNull(users.deletedAt)),
  });
  if (live) {
    return live.clientId === clientId
      ? { ok: false, error: `${email} is already on your team.` }
      : {
          ok: false,
          error: `${email} already has its own FrontDesk login, so it can't join your team too. Ask them for a different email.`,
        };
  }

  try {
    const res = await inviteTeamMember({ clientId, email, role });
    void audit({
      clientId,
      actor: guard.user.email,
      action: "team.invite",
      detail: { email, role, via: res.kind },
    });
    revalidatePath(TEAM_PATH);
    return {
      ok: true,
      message:
        res.kind === "existing_account"
          ? `${email} already has a sign-in — they'll see your business the next time they sign in.`
          : `Invite sent to ${email}.`,
    };
  } catch (err) {
    logger.warn("team.invite.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "The invite didn't go through. Try again in a minute." };
  }
}

/** Cancel a pending invitation (this business's only). */
export async function revokeInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const invitationId = String(formData.get("invitationId") ?? "");
  const guard = await ownerGuard(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!teamInvitesReady()) return { ok: false, error: NOT_READY };
  if (!invitationId) return { ok: false, error: "Invite not found." };

  try {
    const done = await revokePendingInvite(clientId, invitationId);
    if (!done) return { ok: false, error: "Invite not found." };
  } catch (err) {
    logger.warn("team.revoke.failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: "Couldn't cancel that invite. Try again in a minute." };
  }
  void audit({
    clientId,
    actor: guard.user.email,
    action: "team.invite_revoked",
    detail: { invitationId },
  });
  revalidatePath(TEAM_PATH);
  return { ok: true, message: "Invite cancelled." };
}

/** Switch a member between owner and staff. */
export async function setMemberRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = parseTeamRole(formData.get("role"));
  const guard = await ownerGuard(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!role) return { ok: false, error: "Pick owner or staff." };

  const member = await getTeamMember(clientId, userId);
  if (!member) return { ok: false, error: "That person isn't on your team." };
  const next = teamRoleToDb(role);
  if (member.role === next) return { ok: true, message: "No change." };

  if (
    next === "client_viewer" &&
    wouldOrphanBusiness({
      targetRole: member.role,
      ownerCount: await countOwners(clientId),
      change: "demote",
      actorRole: guard.user.role,
    })
  ) {
    return {
      ok: false,
      error: "Your business needs at least one owner. Make someone else an owner first.",
    };
  }

  await setMemberRole(clientId, userId, next);
  void audit({
    clientId,
    actor: guard.user.email,
    action: "team.role_changed",
    detail: { member: member.email, from: member.role, to: next },
  });
  revalidatePath(TEAM_PATH);
  return {
    ok: true,
    message: `${member.email} is now ${role === "owner" ? "an owner" : "staff"}.`,
  };
}

/**
 * Remove a member: they lose portal access immediately (their `users` row is
 * soft-deleted) and their Clerk account is stripped of the membership so the
 * next sign-in can't quietly re-create it. Their Clerk login itself is left
 * alone — it isn't ours to delete.
 */
export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clientId = String(formData.get("clientId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const guard = await ownerGuard(clientId);
  if (!guard.ok) return { ok: false, error: guard.error };

  const member = await getTeamMember(clientId, userId);
  if (!member) return { ok: false, error: "That person isn't on your team." };
  if (
    wouldOrphanBusiness({
      targetRole: member.role,
      ownerCount: await countOwners(clientId),
      change: "remove",
      actorRole: guard.user.role,
    })
  ) {
    return {
      ok: false,
      error: "You can't remove the only owner. Make someone else an owner first.",
    };
  }

  // Clear the Clerk side FIRST: if it fails we stop, rather than leave a
  // membership in their metadata that the next sign-in would resurrect.
  if (member.clerkUserId) {
    if (!teamInvitesReady()) return { ok: false, error: NOT_READY };
    try {
      await clearClerkMembership(member.clerkUserId);
    } catch (err) {
      logger.warn("team.remove.clerk_failed", {
        clientId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, error: "Couldn't remove them right now. Try again in a minute." };
    }
  }
  await removeMember(clientId, userId);
  void audit({
    clientId,
    actor: guard.user.email,
    action: "team.member_removed",
    detail: { member: member.email, role: member.role },
  });
  revalidatePath(TEAM_PATH);
  return {
    ok: true,
    message:
      member.id === guard.user.id
        ? "You've left this business."
        : `${member.email} no longer has access.`,
  };
}
