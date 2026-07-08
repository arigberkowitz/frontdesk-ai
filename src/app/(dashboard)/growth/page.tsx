import type { Metadata } from "next";
import { requireAgencyOperator } from "@/lib/auth-guard";
import { PageHeader } from "@/components/page-header";
import { GrowthProspector } from "@/components/growth-prospector";

export const metadata: Metadata = { title: "Growth" };

/** Agent #7 — lead-gen for the agency itself. */
export default async function GrowthPage() {
  await requireAgencyOperator();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Growth"
        description="Paste prospect websites — the agent reads each one, scores the fit, and drafts the outreach."
      />
      <GrowthProspector />
    </div>
  );
}
