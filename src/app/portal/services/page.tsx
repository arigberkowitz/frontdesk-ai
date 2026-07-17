import type { Metadata } from "next";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { listServices } from "@/lib/data/services";
import { PageHeader } from "@/components/page-header";
import { EditLockBanner } from "@/components/portal/edit-lock-banner";
import { ServicesTab } from "@/components/clients/services-tab";

export const metadata: Metadata = { title: "Services" };

export default async function PortalServicesPage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const services = await listServices(clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Services"
        description="What your AI can answer about and book. Changes go live on your receptionist right away."
      />
      {!editAccess.canEdit ? (
        <EditLockBanner clientId={clientId} hasCode={editAccess.hasCode} />
      ) : null}
      <ServicesTab clientId={clientId} services={services} />
    </div>
  );
}
