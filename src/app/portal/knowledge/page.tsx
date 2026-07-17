import type { Metadata } from "next";
import { GraduationCap } from "lucide-react";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { listKnowledge } from "@/lib/data/knowledge";
import { listReviewedSuggestions } from "@/lib/data/suggestions";
import { PageHeader } from "@/components/page-header";
import { EditLockBanner } from "@/components/portal/edit-lock-banner";
import { KnowledgeTab } from "@/components/clients/knowledge-tab";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Knowledge" };

export default async function PortalKnowledgePage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const [knowledge, learned] = await Promise.all([
    listKnowledge(clientId),
    listReviewedSuggestions(clientId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge"
        description="Everything your AI knows about your business. It only answers from what you add here — so the more you add, the more it can handle. Changes update your receptionist immediately."
      />
      {!editAccess.canEdit ? (
        <EditLockBanner clientId={clientId} hasCode={editAccess.hasCode} />
      ) : null}
      <KnowledgeTab clientId={clientId} knowledge={knowledge} />

      {learned.length > 0 ? (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <GraduationCap className="size-4" />
              </span>
              <div>
                <p className="font-heading text-lg font-semibold tracking-tight">
                  Learned from real calls
                </p>
                <p className="text-sm text-muted-foreground">
                  Improvements the AI proposed after listening to its own calls.
                </p>
              </div>
            </div>
            <ul className="mt-3">
              {learned.map((s) => (
                <li
                  key={s.id}
                  className="flex items-baseline justify-between gap-3 border-t py-2.5 text-sm first:border-t-0"
                >
                  <span
                    className={s.status === "dismissed" ? "text-muted-foreground line-through" : ""}
                  >
                    {s.type === "knowledge" ? s.question : s.guidance}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {s.status === "applied" ? "taught" : "dismissed"}
                    {s.reviewedAt ? ` · ${formatDateTime(s.reviewedAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
