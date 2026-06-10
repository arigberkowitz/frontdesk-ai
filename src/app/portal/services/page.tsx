import type { Metadata } from "next";
import { resolvePortalClient } from "@/lib/auth-guard";
import { listServices } from "@/lib/data/services";
import { PageHeader } from "@/components/page-header";
import { ServicesTab } from "@/components/clients/services-tab";

export const metadata: Metadata = { title: "Services" };

export default async function PortalServicesPage() {
  const { clientId } = await resolvePortalClient();
  const services = await listServices(clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Services"
        description="What your AI can answer about and book. Changes go live on your receptionist right away."
      />
      <ServicesTab clientId={clientId} services={services} />
    </div>
  );
}
