import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Chip, InitialsAvatar, type ChipTone } from "@/components/portal/visual";
import { STATUS_LABELS } from "@/config/options";
import type { PortfolioClientCard } from "@/lib/data/metrics";
import type { ClientStatus } from "@/db/schema";

/** Status as a tinted chip (all AA on their fills): live is the only "go" color. */
const STATUS_TONE: Record<ClientStatus, ChipTone> = {
  live: "emerald",
  trial: "violet",
  paused: "amber",
  draft: "slate",
  churned: "rose",
};

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="fd-stat px-2 py-2 text-center">
      <p className="font-heading text-lg font-semibold leading-none tabular-nums">{n}</p>
      <p className="mt-1 text-[11px] font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

/** Dashboard tile for one client business — identity, status, and today's numbers. */
export function ClientSummaryCard({ client }: { client: PortfolioClientCard }) {
  const status = client.status as ClientStatus;
  return (
    <Link href={`/clients/${client.id}`} className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="fd-lift h-full hover:border-primary/40">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <InitialsAvatar name={client.name} seed={client.id} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading font-semibold leading-tight tracking-tight">{client.name}</p>
              <div className="mt-1.5">
                <Chip tone={STATUS_TONE[status] ?? "slate"} dot>
                  {STATUS_LABELS[status] ?? client.status}
                </Chip>
              </div>
            </div>
            {client.newLeads > 0 ? (
              <Chip tone="amber">{client.newLeads} new</Chip>
            ) : (
              <ArrowUpRight
                className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-brand"
                aria-hidden
              />
            )}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Stat n={client.callsToday} label="today" />
            <Stat n={client.totalCalls} label="calls" />
            <Stat n={client.bookings} label="booked" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
