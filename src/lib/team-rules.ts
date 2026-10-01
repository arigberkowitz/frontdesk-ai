/**
 * Team access rules as pure functions, so they're testable without Clerk or a
 * database. Two tiers inside a business:
 *   - owner  (`client_admin`, or an operator)  — everything, incl. billing,
 *     the team, and where alerts go.
 *   - staff  (`client_viewer`) — day-to-day portal work (calls, appointments,
 *     messages, replies). AI configuration unlocks with the edit code; the
 *     owner-only settings below never do.
 */

import type { UserRole } from "@/db/schema";

export type TeamRole = "owner" | "staff";

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = { owner: "Owner", staff: "Staff" };

/** DB role ↔ the two words a business sees. */
export function teamRoleToDb(role: TeamRole): Extract<UserRole, "client_admin" | "client_viewer"> {
  return role === "owner" ? "client_admin" : "client_viewer";
}
export function dbRoleToTeam(role: UserRole): TeamRole {
  return role === "client_viewer" ? "staff" : "owner";
}
export function parseTeamRole(raw: unknown): TeamRole | null {
  return raw === "owner" || raw === "staff" ? raw : null;
}

/**
 * Fields of the portal profile form that only the owner may change: where
 * alerts go (incl. the SMS-alert, Monday weekly-summary and daily-briefing email toggles). The
 * alert phone is also the live-transfer number, so a staff member pointing it
 * at their own cell would reroute every transfer.
 */
export const OWNER_ONLY_PROFILE_FIELDS = [
  "ownerEmail",
  "alertPhone",
  "smsAlertsEnabled",
  "weeklySummaryEnabled",
  "dailyBriefingEnabled",
] as const;

export function ownerOnlyFieldsIn(formData: FormData): string[] {
  return OWNER_ONLY_PROFILE_FIELDS.filter((f) => formData.has(f));
}

/**
 * Would this change leave the business with no owner? Removing or demoting
 * the last `client_admin` locks the business out of billing and the team.
 * Operators are exempt as actors (they can always fix it from the agency side)
 * and aren't counted here (they're not members of a single business).
 */
export function wouldOrphanBusiness(args: {
  targetRole: UserRole;
  ownerCount: number;
  change: "remove" | "demote";
  actorRole: UserRole;
}): boolean {
  if (args.actorRole === "operator") return false;
  if (args.targetRole !== "client_admin") return false;
  return args.ownerCount <= 1;
}
