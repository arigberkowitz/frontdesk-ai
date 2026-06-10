import type { Metadata } from "next";
import { resolvePortalClient } from "@/lib/auth-guard";
import { listKnowledge } from "@/lib/data/knowledge";
import { PageHeader } from "@/components/page-header";
import { KnowledgeTab } from "@/components/clients/knowledge-tab";

export const metadata: Metadata = { title: "FAQ" };

export default async function PortalKnowledgePage() {
  const { clientId } = await resolvePortalClient();
  const knowledge = await listKnowledge(clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="FAQ"
        description="The answers your AI gives callers. Add or edit anything — it updates your receptionist immediately."
      />
      <KnowledgeTab clientId={clientId} knowledge={knowledge} />
    </div>
  );
}
