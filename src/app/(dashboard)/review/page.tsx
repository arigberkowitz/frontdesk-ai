import type { Metadata } from "next";
import { Inbox } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Review queue" };

export default function ReviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Review queue"
        description="Calls flagged as escalated, negative, or low-confidence — the improvement loop."
      />
      <EmptyState
        icon={Inbox}
        title="No flagged calls yet"
        description="As your agents take calls, any flagged as escalated, negative, or low-confidence will surface here for one-click FAQ additions and prompt tuning."
      />
    </div>
  );
}
