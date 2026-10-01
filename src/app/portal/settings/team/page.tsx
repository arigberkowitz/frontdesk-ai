import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getCurrentDbUser, resolvePortalClient, userIsClientOwner } from "@/lib/auth-guard";
import { listTeamMembers } from "@/lib/data/team";
import { listPendingInvites, teamInvitesReady, type PendingInvite } from "@/lib/team-invites";
import { dbRoleToTeam } from "@/lib/team-rules";
import { logger } from "@/lib/logger";
import { TeamAccess } from "@/components/portal/team-access";
import { EditCodeForm } from "@/components/portal/portal-settings";
import { toSafeClient } from "@/lib/client-safe";

export const metadata: Metadata = { title: "Team access · Settings" };

/** Settings → Team access (owner-only): sign-ins, roles, and the staff edit code. */
export default async function PortalTeamAccessPage() {
  const { clientId } = await resolvePortalClient();
  const me = await getCurrentDbUser();
  // Owner-only. Staff land back on Settings; the actions re-check regardless.
  if (!userIsClientOwner(me, clientId)) redirect("/portal/settings");

  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  const members = await listTeamMembers(clientId);
  const ready = teamInvitesReady();
  let invites: PendingInvite[] = [];
  if (ready) {
    try {
      invites = await listPendingInvites(clientId);
    } catch (err) {
      logger.warn("team.invites.list_failed", {
        clientId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="space-y-6">
      <TeamAccess
        clientId={clientId}
        invitesReady={ready}
        members={members.map((m) => ({
          id: m.id,
          email: m.email,
          role: dbRoleToTeam(m.role),
          isYou: m.id === me.id,
        }))}
        invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role }))}
      />
      {/* Lives with the sign-ins it governs: the code staff enter to unlock
          editing your AI. Owner-only, like this whole section. */}
      <EditCodeForm client={toSafeClient(client)} isAdmin />
    </div>
  );
}
