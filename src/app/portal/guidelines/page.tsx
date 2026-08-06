import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentDbUser, getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listRetellVoices } from "@/lib/retell";
import { integrations } from "@/lib/env";
import { isStripeTestMode } from "@/lib/stripe";
import { PageHeader } from "@/components/page-header";
import { EditLockBanner } from "@/components/portal/edit-lock-banner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GuidelinesForm } from "@/components/portal/guidelines-form";
import { VoicePicker } from "@/components/portal/voice-picker";
import { ProvisionCard } from "@/components/portal/provision-card";
import { TrialCodeCard } from "@/components/portal/trial-code-card";
import { ChoosePlan } from "@/components/portal/choose-plan";
import { clientMayActivate, getTrialState } from "@/lib/data/trial";
import { TestCallButton } from "@/components/clients/test-call-button";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";
import {
  groupVoicesByGender,
  normalizeGender,
  RECOMMENDED_VOICES,
  type VoiceMeta,
} from "@/config/voice";

export const metadata: Metadata = { title: "Your AI" };

export default async function PortalGuidelinesPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const { billing } = await searchParams;
  const { clientId } = await resolvePortalClient();
  const editAccess = await getPortalEditAccess(clientId);
  const [client, me] = await Promise.all([getClientByIdUnsafe(clientId), getCurrentDbUser()]);
  if (!client) notFound();

  // Operators AND the business's own admin manage activation. Whether the admin
  // can actually provision depends on plan/trial state (checked below + in the action).
  const canManage = me.role === "operator" || me.role === "client_admin";
  const mayActivate = me.role === "operator" ? true : await clientMayActivate(clientId);
  const trial = await getTrialState(clientId);
  const retellReady = integrations.retell();
  const agentName = client.agentName?.trim() || DEFAULT_AGENT_NAME;

  // Live Retell voice library (best-effort), grouped into Women / Men. Falls back
  // to a curated pair if Retell isn't connected or the call fails.
  let voices: VoiceMeta[] = [];
  if (retellReady) {
    try {
      voices = await listRetellVoices();
    } catch {
      voices = [];
    }
  }
  let { women, men } = groupVoicesByGender(voices);
  if (women.length === 0 && men.length === 0) {
    ({ women, men } = groupVoicesByGender(RECOMMENDED_VOICES));
  }
  // De-duping can drop the exact saved voice id; re-add it so the dropdown shows
  // its real name (not a generic fallback) for the currently selected voice.
  const cur = client.voiceId;
  if (cur && ![...women, ...men].some((v) => v.voiceId === cur)) {
    const meta = voices.find((v) => v.voiceId === cur);
    if (meta) {
      if (normalizeGender(meta.gender) === "female") women = [meta, ...women];
      else if (normalizeGender(meta.gender) === "male") men = [meta, ...men];
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your AI"
        description="Set what your receptionist says and how it books — then hear it. Changes go live right away."
      />
      {/* Coming back from Stripe. Without this the customer lands on the same
          page they left, with no acknowledgement that they just paid. */}
      {billing === "success" ? (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="py-4 text-sm">
            <span className="font-medium">You&apos;re subscribed — thank you.</span>{" "}
            <span className="text-muted-foreground">
              Your receipt is on its way by email. Activate below and your AI takes its first call.
            </span>
          </CardContent>
        </Card>
      ) : billing === "cancel" ? (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            No payment was taken and nothing changed. Everything you set up is still here whenever
            you want to pick a plan.
          </CardContent>
        </Card>
      ) : null}

      {!editAccess.canEdit ? (
        <EditLockBanner clientId={clientId} hasCode={editAccess.hasCode} />
      ) : null}

      {canManage ? (
        <div className="space-y-4">
          {/* Activation comes first for anyone entitled to it — which, now that
              every signup starts on a free trial, is almost everybody. */}
          {mayActivate ? (
            <ProvisionCard
              clientId={client.id}
              hasAgent={Boolean(client.retellAgentId)}
              phoneNumber={client.retellPhoneNumber}
              agentName={agentName}
              retellReady={retellReady}
              onTrial={client.status === "trial"}
            />
          ) : null}

          {/* Plans and the code box stay reachable throughout the trial. They
              used to render only when a business COULDN'T activate — so the
              moment auto-trials arrived, the one screen holding the code box
              stopped appearing for every person a code was meant for. */}
          {!trial.comped && !trial.subscribed ? (
            <>
              <ChoosePlan
                clientId={client.id}
                cardsReady={integrations.stripe()}
                preselect={client.setupFlags?.intendedPlan ?? null}
                testMode={isStripeTestMode()}
              />
              <TrialCodeCard clientId={client.id} requested={Boolean(client.trialRequestedAt)} />
            </>
          ) : null}
        </div>
      ) : client.retellAgentId ? (
        <Card>
          <CardHeader>
            <CardTitle>Hear your receptionist</CardTitle>
            <CardDescription>
              Talk to your AI right in your browser to check how it sounds — no phone needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TestCallButton clientId={client.id} agentName={agentName} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Voice</CardTitle>
          <CardDescription>
            Pick the voice your receptionist speaks in — grouped by women and men.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VoicePicker clientId={client.id} current={client.voiceId} women={women} men={men} />
        </CardContent>
      </Card>

      <GuidelinesForm client={client} />
    </div>
  );
}
