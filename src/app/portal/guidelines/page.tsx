import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentDbUser, getPortalEditAccess, resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { DEFAULT_VOICE_ID, listRetellVoices } from "@/lib/retell";
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
import { CallMeNow } from "@/components/portal/call-me-now";
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
  const cur = client.voiceId ?? DEFAULT_VOICE_ID;
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
              ownerPhone={client.escalationNumber}
            />
          ) : null}

          {/* Plans and the code box stay reachable throughout the trial. They
              used to render only when a business COULDN'T activate — so the
              moment auto-trials arrived, the one screen holding the code box
              stopped appearing for every person a code was meant for. */}
          {!trial.comped && !trial.subscribed ? (
            trial.expired || trial.daysLeft <= 3 ? (
              // The decision is due: plans open, and the code box for anyone
              // we've promised a longer look.
              <div id="plans" className="scroll-mt-24 space-y-4">
                <ChoosePlan
                  clientId={client.id}
                  cardsReady={integrations.stripe()}
                  preselect={client.setupFlags?.intendedPlan ?? null}
                  testMode={isStripeTestMode()}
                />
                <TrialCodeCard clientId={client.id} requested={Boolean(client.trialRequestedAt)} />
              </div>
            ) : (
              // Mid-trial, pricing is one line that opens on request — not a
              // wall of cards between a new owner and the thing they came to
              // hear. The Overview banner counts the days.
              <details id="plans" className="group scroll-mt-24 rounded-xl border bg-card">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="font-medium">Free trial</span>
                  <span className="text-muted-foreground">
                    {`${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"} left`} — everything&apos;s on,
                    nothing to set up. Plans start at the end.
                  </span>
                  <span className="ml-auto text-xs font-medium underline underline-offset-2 group-open:hidden">
                    See plans
                  </span>
                  <span className="ml-auto hidden text-xs font-medium underline underline-offset-2 group-open:inline">
                    Hide
                  </span>
                </summary>
                <div className="space-y-4 border-t p-4">
                  <ChoosePlan
                    clientId={client.id}
                    cardsReady={integrations.stripe()}
                    preselect={client.setupFlags?.intendedPlan ?? null}
                    testMode={isStripeTestMode()}
                  />
                </div>
              </details>
            )
          ) : null}
        </div>
      ) : client.retellAgentId ? (
        <Card>
          <CardHeader>
            <CardTitle>Hear your receptionist</CardTitle>
            <CardDescription>
              Two ways to try it: talk to your AI in your browser, or have it ring your phone from
              its own number so you hear exactly what a caller hears.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium">In your browser</p>
              <TestCallButton clientId={client.id} agentName={agentName} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">On your phone</p>
              <CallMeNow
                clientId={client.id}
                defaultPhone={client.escalationNumber}
                hasNumber={Boolean(client.retellPhoneNumber)}
              />
            </div>
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
          {/* A business that never chose a voice is speaking as the default one,
              not "no voice yet" — the agent was provisioned with it. */}
          <VoicePicker clientId={client.id} current={client.voiceId ?? DEFAULT_VOICE_ID} women={women} men={men} />
        </CardContent>
      </Card>

      <GuidelinesForm client={client} />
    </div>
  );
}
