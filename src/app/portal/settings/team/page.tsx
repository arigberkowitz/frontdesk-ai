import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentDbUser, resolvePortalClient, userIsClientOwner } from "@/lib/auth-guard";
import { listTeamMembers } from "@/lib/data/team";
import { listPendingInvites, teamInvitesReady, type PendingInvite } from "@/lib/team-invites";
import { dbRoleToTeam } from "@/lib/team-rules";
import { logger } from "@/lib/logger";
import { PageHeader } from "@/components/page-header";
import { TeamAccess } from "@/components/portal/team-access";

export const metadata: Metadata = { title: "Team access" };

export default async function PortalTeamAccessPage() {
  const { clientId } = await resolvePortalClient();
  const me = await getCurrentDbUser();
  // Owner-only. Staff land back on Settings; the actions re-check regardless.
  if (!userIsClientOwner(me, clientId)) redirect("/portal/settings");

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
      <PageHeader
        title="Team access"
        description="Give your staff their own sign-ins, and choose who can manage billing and settings."
      />
      <p className="text-sm">
        <Link
          href="/portal/settings"
          className="text-muted-foreground underline underline-offset-2"
        >
          ← Back to Settings
        </Link>
      </p>
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
    </div>
  );
}
