import type { Metadata } from "next";
import { resolvePortalClient } from "@/lib/auth-guard";
import { listHours } from "@/lib/data/hours";
import { PageHeader } from "@/components/page-header";
import { HoursTab } from "@/components/clients/hours-tab";

export const metadata: Metadata = { title: "Hours" };

export default async function PortalHoursPage() {
  const { clientId } = await resolvePortalClient();
  const hours = await listHours(clientId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hours"
        description="Your business hours — so your AI tells callers when you're open and flags after-hours calls."
      />
      <HoursTab clientId={clientId} hours={hours} />
    </div>
  );
}
