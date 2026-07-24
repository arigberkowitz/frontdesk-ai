"use client";

import { useActionState, useEffect } from "react";
import { Phone, Rocket, Send } from "lucide-react";
import { toast } from "sonner";
import {
  provisionAgentAction,
  publishAgentAction,
  saveAgentConfigAction,
} from "@/lib/actions/agent";
import { initialActionState } from "@/lib/actions/types";
import { Input } from "@/components/ui/input";
import { VoiceSelect } from "@/components/clients/voice-select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import { TestCallButton } from "@/components/clients/test-call-button";
import { formatPhone } from "@/lib/format";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";
import type { Client } from "@/db/schema";
import type { VoiceMeta } from "@/config/voice";

export function AgentConfigTab({
  client,
  retellReady,
  voices,
}: {
  client: Client;
  retellReady: boolean;
  voices: VoiceMeta[];
}) {
  const [cfg, saveAction, savePending] = useActionState(saveAgentConfigAction, initialActionState);
  const [prov, provAction, provPending] = useActionState(provisionAgentAction, initialActionState);
  const [pub, pubAction, pubPending] = useActionState(publishAgentAction, initialActionState);

  useEffect(() => {
    if (cfg.ok) toast.success("Agent config saved");
    else if (cfg.error) toast.error(cfg.error);
  }, [cfg]);
  useEffect(() => {
    if (prov.ok) {
      const data = prov.data as { phoneNumber?: string | null; phoneError?: string | null } | undefined;
      if (data?.phoneNumber) {
        toast.success(`Provisioned — live on ${formatPhone(data.phoneNumber)}.`);
      } else {
        toast.success("Agent provisioned — test it in the browser below.");
        if (data?.phoneError) toast.info(data.phoneError);
      }
    } else if (prov.error) {
      toast.error(prov.error);
    }
  }, [prov]);
  useEffect(() => {
    if (pub.ok) toast.success("Published a new version");
    else if (pub.error) toast.error(pub.error);
  }, [pub]);

  const provisioned = Boolean(client.retellAgentId && client.retellPhoneNumber);
  const hasAgent = Boolean(client.retellAgentId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI agent</CardTitle>
          <CardDescription>Provision the Retell agent + phone number, then publish prompt changes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {provisioned ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <Phone className="size-4" /> Live number:{" "}
              <strong className="tabular-nums">{formatPhone(client.retellPhoneNumber)}</strong>
            </div>
          ) : hasAgent ? (
            <p className="text-sm text-muted-foreground">
              Agent is ready. No phone number yet (that needs a Retell card) — but you can talk to it
              right in your browser below.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Not provisioned yet.</p>
          )}
          {hasAgent ? (
            <TestCallButton
              clientId={client.id}
              agentName={client.agentName?.trim() || DEFAULT_AGENT_NAME}
            />
          ) : null}
          {!retellReady ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Add <code>RETELL_API_KEY</code> to your environment to enable provisioning.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <form action={provAction}>
              <input type="hidden" name="clientId" value={client.id} />
              <SubmitButton pending={provPending} disabled={!retellReady}>
                <Rocket className="size-4" />
                {provisioned ? "Re-provision / sync" : "Provision agent"}
              </SubmitButton>
            </form>
            <form action={pubAction}>
              <input type="hidden" name="clientId" value={client.id} />
              <SubmitButton pending={pubPending} variant="outline" disabled={!hasAgent}>
                <Send className="size-4" />
                Publish prompt
              </SubmitButton>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Greeting, voice & escalation</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveAction} className="space-y-4">
            <input type="hidden" name="clientId" value={client.id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Agent name" hint="What the receptionist calls itself on calls.">
                <Input
                  name="agentName"
                  defaultValue={client.agentName ?? ""}
                  placeholder={DEFAULT_AGENT_NAME}
                />
              </Field>
              <Field label="Voice" hint="The voice your receptionist speaks in.">
                <VoiceSelect defaultValue={client.voiceId} liveVoices={voices} />
              </Field>
            </div>
            <Field label="Greeting">
              <Textarea
                name="greeting"
                rows={2}
                defaultValue={client.greeting ?? ""}
                placeholder="Hi, thanks for calling! How can I help?"
              />
            </Field>
            <Field label="Escalation number" hint="Warm transfer + owner alerts">
              <Input
                name="escalationNumber"
                defaultValue={client.escalationNumber ?? ""}
                placeholder="+1 415 555 0100"
              />
            </Field>
            <div className="flex items-center gap-2">
              <Switch
                id="recordingDisclosureEnabled"
                name="recordingDisclosureEnabled"
                defaultChecked={client.recordingDisclosureEnabled}
              />
              <Label htmlFor="recordingDisclosureEnabled">
                Include recording / AI disclosure (recommended)
              </Label>
            </div>
            <Field label="Custom disclosure line" hint="Leave blank to use the default.">
              <Textarea
                name="recordingDisclosureLine"
                rows={2}
                defaultValue={client.recordingDisclosureLine ?? ""}
              />
            </Field>
            <Field
              label="What the AI may say"
              hint="Guardrails — highest priority. The client can also edit this in their portal."
            >
              <Textarea
                name="agentGuidance"
                rows={4}
                defaultValue={client.agentGuidance ?? ""}
                placeholder="e.g. Always mention we're accepting new patients. Never quote exact prices — say it depends on their plan. Don't give medical advice."
              />
            </Field>
            <Field label="How to handle booking" hint="Rules the AI follows when booking.">
              <Textarea
                name="bookingInstructions"
                rows={4}
                defaultValue={client.bookingInstructions ?? ""}
                placeholder="e.g. Only book cleanings and new-patient exams. For anything else, take a message. Always read the appointment back to confirm."
              />
            </Field>
            <div className="flex justify-end">
              <SubmitButton pending={savePending}>Save</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Legal note: you’re responsible for confirming call-recording consent rules in your
        jurisdiction (several states require all-party consent). FrontDesk AI provides the
        disclosure mechanism, not legal advice.
      </p>
    </div>
  );
}
