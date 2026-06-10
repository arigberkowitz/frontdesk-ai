import Link from "next/link";
import { Moon, Phone } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime, formatDuration, formatPhone } from "@/lib/format";
import { CALL_OUTCOME_LABELS } from "@/config/options";
import type { Call, CallOutcome } from "@/db/schema";

const OUTCOME_VARIANT: Record<CallOutcome, "default" | "secondary" | "outline" | "destructive"> = {
  booked: "default",
  lead: "secondary",
  faq_answered: "outline",
  escalated: "destructive",
  spam: "outline",
  missed: "destructive",
  other: "outline",
};

export function CallsTable({
  clientId,
  calls,
  callHref,
  timezone,
}: {
  clientId: string;
  calls: Call[];
  callHref?: (id: string) => string;
  timezone?: string;
}) {
  const hrefFor = callHref ?? ((id: string) => `/clients/${clientId}/calls/${id}`);
  if (!calls.length) {
    return (
      <EmptyState
        icon={Phone}
        title="No calls yet"
        description="Answered calls will appear here with transcripts and outcomes."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead className="hidden sm:table-cell">From</TableHead>
            <TableHead className="hidden md:table-cell">Length</TableHead>
            <TableHead>Outcome</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Link href={hrefFor(c.id)} className="hover:underline">
                  {formatDateTime(c.startAt, timezone)}
                </Link>
                {c.isAfterHours ? (
                  <Moon className="ml-1 inline size-3.5 text-muted-foreground" aria-label="After hours" />
                ) : null}
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {formatPhone(c.fromNumber)}
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">
                {formatDuration(c.durationSec)}
              </TableCell>
              <TableCell>
                {c.outcome ? (
                  <Badge variant={OUTCOME_VARIANT[c.outcome]}>{CALL_OUTCOME_LABELS[c.outcome]}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
