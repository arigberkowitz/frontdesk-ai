import type { Metadata } from "next";
import { resolvePortalClient } from "@/lib/auth-guard";
import { listKnowledge } from "@/lib/data/knowledge";
import { PageHeader } from "@/components/page-header";
import { KnowledgeTab } from "@/components/clients/knowledge-tab";

export const metadata: Metadata = { title: "Knowledge" };

export default async function PortalKnowledgePage() {
  const { clientId } = await resolvePortalClient();
  const knowledge = await listKnowledge(clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge"
        description="Everything your AI knows about your business. It only answers from what you add here — so the more you add, the more it can handle. Changes update your receptionist immediately."
      />
      <KnowledgeTab clientId={clientId} knowledge={knowledge} />
    </div>
  );
}
