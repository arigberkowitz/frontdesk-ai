"use client";

import { useActionState, useEffect, useRef } from "react";
import { Crown, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import {
  addProviderAction,
  removeProviderAction,
  setClockAction,
  setStaffModeAction,
} from "@/lib/actions/providers";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { formatCurrencyCents } from "@/lib/format";

export interface TeamMemberView {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  onClock: boolean;
  todayCount: number;
  totalBookings: number;
  earnedRevenueCents: number;
  todayAppointments: { id: string; when: string; customer: string | null; service: string | null }[];
}

function useToastState(state: ActionState) {
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);
}

function ClockSwitch({
  clientId,
  member,
  canToggle,
}: {
  clientId: string;
  member: TeamMemberView;
  canToggle: boolean;
}) {
  const [state, action, pending] = useActionState(setClockAction, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);
  useToastState(state);
  if (!canToggle) {
    return (
      <span className="text-xs text-muted-foreground">
        {member.onClock ? "On the clock" : "Off"}
      </span>
    );
  }
  return (
    <form ref={formRef} action={action} className="flex items-center gap-2">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="providerId" value={member.id} />
      <input type="hidden" name="onClock" value={member.onClock ? "false" : "true"} />
      <Switch
        id={`clock-${member.id}`}
        checked={member.onClock}
        disabled={pending}
        onCheckedChange={() => formRef.current?.requestSubmit()}
      />
      <Label htmlFor={`clock-${member.id}`} className="text-xs">
        {member.onClock ? "On the clock" : "Clock in"}
      </Label>
    </form>
  );
}

function RemoveButton({ clientId, providerId }: { clientId: string; providerId: string }) {
  const [state, action, pending] = useActionState(removeProviderAction, initialActionState);
  useToastState(state);
  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="providerId" value={providerId} />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={pending}
        className="text-muted-foreground hover:text-destructive"
      >
        Remove
      </Button>
    </form>
  );
}

function MemberCard({
  clientId,
  member,
  topEarner,
  isAdmin,
  viewerEmail,
}: {
  clientId: string;
  member: TeamMemberView;
  topEarner: boolean;
  isAdmin: boolean;
  viewerEmail: string;
}) {
  const isSelf = Boolean(
    member.email && member.email.toLowerCase() === viewerEmail.toLowerCase(),
  );
  const initials = member.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Card
      className={`fd-lift relative overflow-hidden transition-shadow ${
        member.onClock ? "border-emerald-500/40 shadow-[0_0_24px_-8px_rgba(16,185,129,0.35)]" : ""
      }`}
    >
      {member.onClock ? (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      ) : null}
      <CardContent className="p-5">
        <div className="flex items-center gap-3">
          <div
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-heading text-lg font-semibold tracking-tight">
              {member.name}
              {isSelf ? <span className="text-xs font-normal text-muted-foreground">(you)</span> : null}
              {topEarner && member.earnedRevenueCents > 0 ? (
                <Crown className="size-4 text-amber-500" aria-label="Top earner" />
              ) : null}
            </p>
            <ClockSwitch clientId={clientId} member={member} canToggle={isAdmin || isSelf} />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-muted/60 p-2">
            <p className="font-heading text-xl font-semibold tabular-nums">{member.todayCount}</p>
            <p className="text-[11px] text-muted-foreground">today</p>
          </div>
          <div className="rounded-lg bg-muted/60 p-2">
            <p className="font-heading text-xl font-semibold tabular-nums">{member.totalBookings}</p>
            <p className="text-[11px] text-muted-foreground">all time</p>
          </div>
          <div className="rounded-lg bg-emerald-500/10 p-2">
            <p className="font-heading text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrencyCents(member.earnedRevenueCents)}
            </p>
            <p className="text-[11px] text-muted-foreground">earned</p>
          </div>
        </div>

        {member.todayAppointments.length > 0 ? (
          <ul className="mt-4 space-y-1.5 border-t pt-3">
            {member.todayAppointments.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">
                  {a.customer ?? "Customer"}
                  {a.service ? (
                    <span className="text-muted-foreground"> · {a.service}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{a.when}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            Nothing on the books today.
          </p>
        )}

        {isAdmin ? (
          <div className="mt-2 flex justify-end">
            <RemoveButton clientId={clientId} providerId={member.id} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AddMemberForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(addProviderAction, initialActionState);
  useToastState(state);
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={UserPlus}
          title="Add a team member"
          description="Their email links their portal login to their own view; their phone gets on-the-clock alerts."
        />
        <form action={action} className="mt-4 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="clientId" value={clientId} />
          <Field label="Name" error={state.fieldErrors?.name}>
            <Input name="name" placeholder="Sam Alvarez" />
          </Field>
          <Field label="Email (optional)" error={state.fieldErrors?.email}>
            <Input name="email" type="email" placeholder="sam@yourbusiness.com" />
          </Field>
          <Field label="Phone (optional)">
            <Input name="phone" placeholder="+1 415 555 0100" />
          </Field>
          <div className="sm:col-span-3 flex justify-end">
            <SubmitButton pending={pending}>Add to team</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Staff-mode master switch + the team board itself. */
export function TeamBoard({
  clientId,
  enabled,
  isAdmin,
  viewerEmail,
  members,
}: {
  clientId: string;
  enabled: boolean;
  isAdmin: boolean;
  viewerEmail: string;
  members: TeamMemberView[];
}) {
  const [modeState, modeAction, modePending] = useActionState(
    setStaffModeAction,
    initialActionState,
  );
  const modeFormRef = useRef<HTMLFormElement>(null);
  useToastState(modeState);

  const topEarnerId = members.reduce<{ id: string; cents: number } | null>(
    (best, m) =>
      m.earnedRevenueCents > (best?.cents ?? 0) ? { id: m.id, cents: m.earnedRevenueCents } : best,
    null,
  )?.id;

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <Card>
          <CardContent className="p-5 sm:p-6">
            <PanelHeader
              icon={Users}
              title="Staff mode"
              description="On: your AI books by person ('anyone in particular?'), each teammate gets their own day view and stats, and whoever's on the clock gets the alerts. Off: simple solo booking."
            />
            <form ref={modeFormRef} action={modeAction} className="mt-4">
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
              <div className="flex items-center gap-2">
                <Switch
                  id="staffMode"
                  checked={enabled}
                  disabled={modePending}
                  onCheckedChange={() => modeFormRef.current?.requestSubmit()}
                />
                <Label htmlFor="staffMode">Book by person &amp; per-staff views</Label>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {enabled ? (
        <>
          {members.length > 0 ? (
            <div className="fd-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((m) => (
                <MemberCard
                  key={m.id}
                  clientId={clientId}
                  member={m}
                  topEarner={m.id === topEarnerId}
                  isAdmin={isAdmin}
                  viewerEmail={viewerEmail}
                />
              ))}
            </div>
          ) : null}
          {isAdmin ? <AddMemberForm clientId={clientId} /> : null}
        </>
      ) : null}
    </div>
  );
}
