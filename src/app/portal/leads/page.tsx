import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { listLeads } from "@/lib/data/leads";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LeadStatusControl } from "@/components/clients/lead-status-control";
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
          {leads.map((l) => {
            const initial = (l.name ?? "Caller").trim().charAt(0).toUpperCase() || "?";
            const tel = (l.phone ?? "").replace(/[^\d+]/g, "");
            return (
              <li key={l.id} className="flex items-start justify-between gap-3 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-sm font-semibold text-indigo-600 dark:text-indigo-400"
                    aria-hidden="true"
                  >
                    {initial}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">{l.name ?? "Caller"}</p>
                    <p className="text-sm text-muted-foreground">
                      {tel ? (
                        <a href={`tel:${tel}`} className="hover:text-foreground hover:underline">
                          {formatPhone(l.phone)}
                        </a>
                      ) : (
                        formatPhone(l.phone)
                      )}
                      {l.reason ? ` · ${l.reason}` : ""}
                    </p>
                    {l.message ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        &ldquo;{l.message}&rdquo;
                      </p>
                    ) : null}
                  </div>
                </div>
                <LeadStatusControl leadId={l.id} clientId={clientId} status={l.status} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
