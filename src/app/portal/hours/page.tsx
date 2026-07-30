import type { Metadata } from "next";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listHours } from "@/lib/data/hours";
import { listAllBlocks } from "@/lib/data/availability-blocks";
import { listProviders } from "@/lib/data/providers";
import { PageHeader } from "@/components/page-header";
import { EditLockBanner } from "@/components/portal/edit-lock-banner";
import { HoursTab } from "@/components/clients/hours-tab";
import { TimeOffCard } from "@/components/portal/time-off-card";
import { TimezoneCard } from "@/components/portal/timezone-card";

export const metadata: Metadata = { title: "Hours" };

export default async function PortalHoursPage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const [hours, client, blocks] = await Promise.all([
    listHours(clientId),
    getClientByIdUnsafe(clientId),
    listAllBlocks(clientId),
  ]);

  const tz = client?.timezone ?? "America/Los_Angeles";
  const team = client?.staffModeEnabled ? await listProviders(clientId) : [];
  const providerName = new Map(team.map((p) => [p.id, p.name]));
  // One-off windows are formatted server-side in the BUSINESS's timezone — the
  // viewer's browser zone is irrelevant here and would mislabel the closure.
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  const timeOff = blocks.map((b) => ({
    id: b.id,
    label: b.label,
    providerName: b.providerId ? (providerName.get(b.providerId) ?? null) : null,
    dayOfWeek: b.dayOfWeek,
    startTime: b.startTime,
    endTime: b.endTime,
    windowLabel:
      b.startsAt && b.endsAt ? `${fmt(new Date(b.startsAt))} – ${fmt(new Date(b.endsAt))}` : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hours"
        description="Your business hours — so your AI tells callers when you're open and flags after-hours calls."
      />
      {!editAccess.canEdit ? (
        <EditLockBanner clientId={clientId} hasCode={editAccess.hasCode} />
      ) : null}
      <HoursTab clientId={clientId} hours={hours} />
      <TimeOffCard
        clientId={clientId}
        blocks={timeOff}
        providers={team.filter((p) => p.isActive).map((p) => ({ id: p.id, name: p.name }))}
        canEdit={editAccess.canEdit}
      />
      {editAccess.canEdit && client ? (
        <TimezoneCard clientId={clientId} timezone={client.timezone} />
      ) : null}
    </div>
  );
}
