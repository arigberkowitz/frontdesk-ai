import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { AiNumberCard } from "@/components/portal/ai-number-card";
import { HandoffCard } from "@/components/portal/handoff-card";
import { EmergencyCard } from "@/components/portal/trades-cards";
import { HumanTouchForm } from "@/components/portal/portal-settings";
import { LanguagesCard } from "@/components/portal/languages-card";
import { ReceptionistPower } from "@/components/portal/receptionist-power";
import { toSafeClient } from "@/lib/client-safe";
import { TextingControlsCard } from "@/components/portal/texting-controls-card";
import { getTextingPrefs } from "@/lib/data/texting-prefs";
import { DEFAULT_QUIET_END, DEFAULT_QUIET_START } from "@/lib/texting-policy";
import { TollfreeTextingCard } from "@/components/portal/tollfree-texting-card";
import { getCurrentDbUser, userIsClientOwner } from "@/lib/auth-guard";
import { tollfreeStore } from "@/lib/data/tollfree";
import { env } from "@/lib/env";
import { formatUsPhone } from "@/lib/sms-number-format";
import { tollfreeView } from "@/lib/tollfree/status";

export const metadata: Metadata = { title: "Phone & AI · Settings" };

/** Settings → Phone & AI: on/off, the AI's number + forwarding, handing callers to a person, and languages. */
export default async function PortalSettingsPhonePage() {
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const client = await getClientByIdUnsafe(clientId);
  if (!client) notFound();
  const tollfree = env.TOLLFREE_SMS_ENABLED ? await tollfreeStore.get(clientId) : null;
  const needsOwner = env.TOLLFREE_SMS_ENABLED || env.OWNER_TEXTING_CONTROLS;
  const isOwner = needsOwner ? userIsClientOwner(await getCurrentDbUser(), clientId) : false;
  const textingPrefs = env.OWNER_TEXTING_CONTROLS ? await getTextingPrefs(clientId) : null;
  const { ein, ...shownDetails } = tollfree?.details ?? {};

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
      <EmergencyCard
        clientId={clientId}
        transfer247={client.setupFlags?.emergency?.transfer247 === true}
        onCallNumber={client.setupFlags?.emergency?.onCallNumber}
        escalationNumber={client.escalationNumber}
        canEdit={editAccess.canEdit}
      />
      <HumanTouchForm client={toSafeClient(client)} />
      {env.TOLLFREE_SMS_ENABLED ? (
        <TollfreeTextingCard
          clientId={clientId}
          view={tollfreeView(tollfree)}
          phoneNumber={tollfree?.phoneNumber ? formatUsPhone(tollfree.phoneNumber) : null}
          details={shownDetails}
          einOnFile={ein ? ein.replace(/\D/g, "").slice(-4) : null}
          isOwner={isOwner}
        />
      ) : null}
      {env.OWNER_TEXTING_CONTROLS ? (
        <TextingControlsCard
          clientId={clientId}
          textingEnabled={textingPrefs?.textingEnabled ?? true}
          quietStartHour={textingPrefs?.quietStartHour ?? DEFAULT_QUIET_START}
          quietEndHour={textingPrefs?.quietEndHour ?? DEFAULT_QUIET_END}
          timeZone={client.timezone}
          isOwner={isOwner}
        />
      ) : null}
      <LanguagesCard clientId={clientId} languages={client.languages} canEdit={editAccess.canEdit} />
    </div>
  );
}
