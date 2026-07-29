import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentDbUser, getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getProviderStats, listProviderAppointments } from "@/lib/data/providers";
import { PageHeader } from "@/components/page-header";
import { TeamBoard, type TeamMemberView } from "@/components/portal/team-board";

function formatTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export const metadata: Metadata = { title: "Team" };

/** Today's window in the client's timezone. */
function todayWindow(tz: string): { start: Date; end: Date } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(now).split("-").map(Number);
  // Midnight local ≈ construct from the tz offset at now (good enough for a day view).
  const offsetMin = -new Date(now.toLocaleString("en-US", { timeZone: tz })).getTimezoneOffset();
  void offsetMin;
  const startUtcGuess = new Date(Date.UTC(y!, m! - 1, d!, 0, 0, 0));
  // Correct the guess by the difference between the tz's rendering and UTC.
  const rendered = new Date(startUtcGuess.toLocaleString("en-US", { timeZone: tz }));
  const diff = startUtcGuess.getTime() - rendered.getTime();
  const start = new Date(startUtcGuess.getTime() + diff);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export default async function PortalTeamPage() {
  const { clientId } = await resolvePortalClient();
  const user = await getCurrentDbUser();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();

  const { start, end } = todayWindow(client.timezone);
  const stats = client.staffModeEnabled ? await getProviderStats(clientId, start, end) : [];

  const members: TeamMemberView[] = await Promise.all(
    stats.map(async (s) => {
      const todays = await listProviderAppointments(clientId, s.provider.id, start, end);
      return {
        id: s.provider.id,
        name: s.provider.name,
        email: s.provider.email,
        phone: s.provider.phone,
        onClock: s.provider.onClock,
        todayCount: s.todayCount,
        totalBookings: s.totalBookings,
        earnedRevenueCents: s.earnedRevenueCents,
        todayAppointments: todays.map((a) => ({
          id: a.id,
          when: formatTime(a.startAt, client.timezone),
          customer: a.customerName,
          service: a.service?.name ?? null,
        })),
      };
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description={
          client.staffModeEnabled
            ? "Who's on the clock, who's crushing it, and everyone's day at a glance."
            : "Turn on staff mode to book by person and give every teammate their own view."
        }
      />
      <TeamBoard
        clientId={clientId}
        enabled={client.staffModeEnabled}
        isAdmin={editAccess.isAdmin}
        viewerEmail={user.email}
        members={members}
      />
    </div>
  );
}
