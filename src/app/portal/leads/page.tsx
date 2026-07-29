import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listLeads } from "@/lib/data/leads";
import { remindersByLead } from "@/lib/data/reminders";
import { insightsByCall } from "@/lib/data/insights";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { LeadStatusControl } from "@/components/clients/lead-status-control";
import { LeadFollowup } from "@/components/portal/lead-followup";
import { formatPhone } from "@/lib/format";
import { vocabFor } from "@/lib/vocab";

export const metadata: Metadata = { title: "Leads" };

/** Qualification chip — only renders when the AI captured that detail. */
function Qual({ label, value, className }: { label: string; value: string | null; className: string }) {
  if (!value) return null;
  return (
    <span className={`break-words rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}: {value}
    </span>
  );
}

export default async function PortalLeadsPage() {
  const { clientId } = await resolvePortalClient();
  const [client, leads, reminderMap] = await Promise.all([
    getClientByIdUnsafe(clientId),
    listLeads(clientId),
    remindersByLead(clientId),
  ]);
  const v = vocabFor(client?.industry);
  const insightMap = await insightsByCall(
    clientId,
    leads.map((l) => l.callId).filter((id): id is string => Boolean(id)),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description={`People your AI took a message from, with what they need — follow up to win the ${v.customer}.`}
      />
      {leads.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No leads yet"
          description="Messages your AI captures will show up here."
        />
      ) : (
        <>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {leads.length} {leads.length === 1 ? "lead" : "leads"}
          </p>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href="/portal/leads/export" download="leads.csv" />}
          >
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>
        <ul className="mt-3 divide-y rounded-xl border">
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
                            className="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                          />
                          <Qual
                            label="Timing"
                            value={l.urgency}
                            className="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          />
                          <Qual
                            label="Budget"
                            value={l.budget}
                            className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <LeadStatusControl leadId={l.id} clientId={clientId} status={l.status} />
                </div>
                <div className="mt-3 border-t pt-3 sm:pl-12">
                  <LeadFollowup
                    clientId={clientId}
                    leadId={l.id}
                    phone={l.phone}
                    history={history}
                    draft={l.callId ? insightMap[l.callId]?.followUpDraft : null}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </div>
  );
}
