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
import { InitialsAvatar } from "@/components/portal/visual";
import { vocabFor } from "@/lib/vocab";

export const metadata: Metadata = { title: "Leads" };

/** The follow-up pipeline, left to right. Colors match the status dropdown. */
const PIPELINE = [
  { key: "new", label: "New", color: "#f59e0b" },
  { key: "contacted", label: "Contacted", color: "#3b82f6" },
  { key: "won", label: "Won", color: "#10b981" },
  { key: "lost", label: "Lost", color: "#94a3b8" },
] as const;

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
          description="Anyone your AI takes a message from will show up here."
        />
      ) : (
        <>
        {/* Pipeline at a glance: how many leads sit at each stage. Display only. */}
        <section aria-label="Lead pipeline" className="fd-panel p-4 sm:p-5">
          <div aria-hidden className="fd-panel-glow" />
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="fd-eyebrow">Pipeline</p>
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
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {PIPELINE.map((stage) => {
              const count = leads.filter((l) => l.status === stage.key).length;
              return (
                <li
                  key={stage.key}
                  className="fd-stage-chip"
                  data-active={count > 0 ? "true" : undefined}
                  style={{ "--stage": stage.color } as React.CSSProperties}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: stage.color }} aria-hidden />
                    {stage.label}
                  </span>
                  <span className="font-heading text-2xl leading-none font-semibold tabular-nums">{count}</span>
                  <span className="fd-stage-bar" aria-hidden>
                    <span style={{ width: `${leads.length ? Math.round((count / leads.length) * 100) : 0}%` }} />
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            {leads.length} {leads.length === 1 ? "lead" : "leads"} in total
          </p>
        </section>
        <ul className="fd-stagger mt-4 space-y-3">
          {leads.map((l) => {
            const tel = (l.phone ?? "").replace(/[^\d+]/g, "");
            const history = (reminderMap[l.id] ?? []).map((r) => ({
              channel: r.channel,
              status: r.status,
              at: (r.sentAt ?? r.createdAt).toISOString(),
            }));
            const hasQual = Boolean(l.service || l.urgency || l.budget);
            return (
              <li key={l.id} className="fd-row p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <InitialsAvatar name={l.name} seed={l.phone ?? l.id} className="mt-0.5" />
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
                            className="bg-brand-soft text-brand ring-1 ring-brand/15"
                          />
                          <Qual
                            label="Timing"
                            value={l.urgency}
                            className="bg-amber-50 text-amber-800 ring-1 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400"
                          />
                          <Qual
                            label="Budget"
                            value={l.budget}
                            className="bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400"
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <LeadStatusControl leadId={l.id} clientId={clientId} status={l.status} />
                </div>
                <div className="mt-3 border-t border-border/70 pt-3 sm:pl-[3.25rem]">
                  <LeadFollowup
                    clientId={clientId}
                    leadId={l.id}
                    phone={l.phone}
                    history={history}
                    draft={l.callId ? insightMap[l.callId]?.followUpDraft : null}
                    businessName={client?.name ?? "us"}
                    customerName={l.name}
                    // What they asked for and when, so the confirm template says
                    // "your consultation tomorrow" rather than "your
                    // appointment" — the caller told us both on the call.
                    service={l.service}
                    timing={l.urgency}
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
