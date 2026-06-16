import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/clients/status-badge";
import type { PortfolioClientCard } from "@/lib/data/metrics";
import type { ClientStatus } from "@/db/schema";

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="text-center">
      <p className="font-heading text-lg font-semibold leading-none tabular-nums">{n}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Dashboard tile for one client business — identity, status, and today's numbers. */
export function ClientSummaryCard({ client }: { client: PortfolioClientCard }) {
  const initial = client.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <Link href={`/clients/${client.id}`} className="group block">
      <Card className="fd-lift h-full hover:border-primary/40">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
              style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
              aria-hidden="true"
            >
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium leading-tight">{client.name}</p>
              <div className="mt-1">
                <StatusBadge status={client.status as ClientStatus} />
              </div>
            </div>
            {client.newLeads > 0 ? (
              <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
                {client.newLeads} new
              </span>
            ) : (
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
            )}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3">
            <Stat n={client.callsToday} label="today" />
            <Stat n={client.totalCalls} label="calls" />
            <Stat n={client.bookings} label="booked" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
