import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "@/config/options";
import type { ClientStatus } from "@/db/schema";

const VARIANT: Record<ClientStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  trial: "secondary",
  live: "default",
  paused: "outline",
  churned: "destructive",
};

export function StatusBadge({ status }: { status: ClientStatus }) {
  return <Badge variant={VARIANT[status]}>{STATUS_LABELS[status]}</Badge>;
}
