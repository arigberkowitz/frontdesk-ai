import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { listLeads } from "@/lib/data/leads";
import { remindersByLead } from "@/lib/data/reminders";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { LeadStatusControl } from "@/components/clients/lead-status-control";
import { LeadFollowup } from "@/components/portal/lead-followup";
import { formatPhone } from "@/lib/format";

export const metadata: Metadata = { title: "Leads" };

/** Qualification chip — only renders when the AI captured that detail. */
function Qual({ label, value, className }: { label: string; value: string | null; className: string }) {
  if (!value) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}: {value}
    </span>
  );
}

export default async function PortalLeadsPage() {
  const { clientId } = await resolvePortalClient();
  const [leads, reminderMap] = await Promise.all([listLeads(clientId), remindersByLead(clientId)]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="People your AI took a message from, with what they need — follow up to win the customer."
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
            const history = (reminderMap[l.id] ?? []).map((r) => ({
              channel: r.channel,
              status: r.status,
              at: (r.sentAt ?? r.createdAt).toISOString(),
            }));
            const hasQual = Boolean(l.service || l.urgency || l.budget);
            return (
              <li key={l.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
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
                      {hasQual ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Qual
                            label="Wants"
                            value={l.service}
                            className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                          />
                          <Qual
                            label="Timing"
                            value={l.urgency}
                            className="bg-amber-500/10 text-amber-600 dark:text-amber-300"
                          />
                          <Qual
                            label="Budget"
                            value={l.budget}
                            className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <LeadStatusControl leadId={l.id} clientId={clientId} status={l.status} />
                </div>
                <div className="mt-3 border-t pt-3 sm:pl-12">
                  <LeadFollowup clientId={clientId} leadId={l.id} phone={l.phone} history={history} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
