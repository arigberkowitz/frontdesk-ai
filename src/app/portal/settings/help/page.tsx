import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { HelpForm } from "@/components/portal/portal-settings";
import { SupportCard } from "@/components/portal/support-card";

export const metadata: Metadata = { title: "Help · Settings" };

/** Settings → Help: a real person to text or call, and a note-to-support form. */
export default async function PortalSettingsHelpPage() {
  const { clientId } = await resolvePortalClient();
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();

  return (
    <div className="space-y-6">
      <SupportCard />
      <HelpForm client={client} />
    </div>
  );
}
