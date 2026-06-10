import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { listClients } from "@/lib/data/clients";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ClientsTable } from "@/components/clients/clients-table";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  const user = await requireOperator();
  const clients = await listClients(user.orgId);

  return (
    <div className="space-y-6">
      <PageHeader title="Clients" description="Every business you manage.">
        <Button render={<Link href="/clients/new" />} nativeButton={false}>
          <Plus className="size-4" />
          New client
        </Button>
      </PageHeader>

      {clients.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No clients yet"
          description="Onboard your first business, configure its AI receptionist, and start catching every call."
        >
          <Button render={<Link href="/clients/new" />} nativeButton={false}>
            <Plus className="size-4" />
            Add a client
          </Button>
        </EmptyState>
      ) : (
        <ClientsTable clients={clients} />
      )}
    </div>
  );
}
