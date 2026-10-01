import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { AiNumberCard } from "@/components/portal/ai-number-card";
import { HandoffCard } from "@/components/portal/handoff-card";
import { HumanTouchForm } from "@/components/portal/portal-settings";
import { LanguagesCard } from "@/components/portal/languages-card";
import { ReceptionistPower } from "@/components/portal/receptionist-power";
import { toSafeClient } from "@/lib/client-safe";

export const metadata: Metadata = { title: "Phone & AI · Settings" };

/** Settings → Phone & AI: on/off, the AI's number + forwarding, handing callers to a person, and languages. */
export default async function PortalSettingsPhonePage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();

  return (
    <div className="space-y-6">
      <ReceptionistPower
        clientId={clientId}
        status={client.status}
        isAdmin={editAccess.isAdmin}
        hasAgent={Boolean(client.retellAgentId)}
      />
      <AiNumberCard
        clientId={clientId}
        phoneNumber={client.retellPhoneNumber}
        mode={client.answeringMode === "missed_only" ? "missed_only" : "all_calls"}
        forwardingDone={Boolean(client.setupFlags?.forwardingDone)}
        isAdmin={editAccess.isAdmin}
        canEdit={editAccess.canEdit}
      />
      {/* The wrong value here is the worst call this product can make, so it
          sits right under the number, not further down. */}
      <HandoffCard
        clientId={clientId}
        mode={client.setupFlags?.handoffMode ?? "always"}
        escalationNumber={client.escalationNumber}
      />
      <HumanTouchForm client={toSafeClient(client)} />
      <LanguagesCard clientId={clientId} languages={client.languages} canEdit={editAccess.canEdit} />
    </div>
  );
}
