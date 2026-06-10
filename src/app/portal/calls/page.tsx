import type { Metadata } from "next";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listCalls } from "@/lib/data/calls";
import { PageHeader } from "@/components/page-header";
import { CallsTable } from "@/components/clients/calls-table";

export const metadata: Metadata = { title: "Calls" };

export default async function PortalCallsPage() {
  const { clientId } = await resolvePortalClient();
  const [client, calls] = await Promise.all([
    getClientByIdUnsafe(clientId),
    listCalls(clientId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Calls" description="Every call your AI receptionist answered." />
      <CallsTable
        clientId={clientId}
        calls={calls}
        callHref={(id) => `/portal/calls/${id}`}
        timezone={client?.timezone}
      />
    </div>
  );
}
