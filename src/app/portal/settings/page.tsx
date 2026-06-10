import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { PageHeader } from "@/components/page-header";
import { PortalSettings } from "@/components/portal/portal-settings";

export const metadata: Metadata = { title: "Settings" };

export default async function PortalSettingsPage() {
  const { clientId } = await resolvePortalClient();
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your business details, where we send alerts, and how to reach us for help."
      />
      <PortalSettings client={client} />
    </div>
  );
}
