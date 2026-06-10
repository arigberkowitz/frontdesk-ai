import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { listLeads } from "@/lib/data/leads";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatPhone } from "@/lib/format";

export const metadata: Metadata = { title: "Leads" };

export default async function PortalLeadsPage() {
  const { clientId } = await resolvePortalClient();
  const leads = await listLeads(clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="People your AI took a message from — follow up to win the business."
      />
      {leads.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No leads yet"
          description="Messages your AI captures will show up here."
        />
      ) : (
        <ul className="divide-y rounded-xl border">
          {leads.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{l.name ?? "Caller"}</p>
                <p className="text-sm text-muted-foreground">
                  {formatPhone(l.phone)}
                  {l.reason ? ` · ${l.reason}` : ""}
                  {l.message ? ` — "${l.message}"` : ""}
                </p>
              </div>
              <Badge variant="outline" className="capitalize">
                {l.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
