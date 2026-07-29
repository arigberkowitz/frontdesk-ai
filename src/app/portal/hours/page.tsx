import type { Metadata } from "next";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listHours } from "@/lib/data/hours";
import { PageHeader } from "@/components/page-header";
import { EditLockBanner } from "@/components/portal/edit-lock-banner";
import { HoursTab } from "@/components/clients/hours-tab";
import { TimezoneCard } from "@/components/portal/timezone-card";

export const metadata: Metadata = { title: "Hours" };

export default async function PortalHoursPage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const [hours, client] = await Promise.all([listHours(clientId), getClientByIdUnsafe(clientId)]);

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
      {editAccess.canEdit && client ? (
        <TimezoneCard clientId={clientId} timezone={client.timezone} />
      ) : null}
    </div>
  );
}
