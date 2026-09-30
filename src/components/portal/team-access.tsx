"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  inviteStaffAction,
  removeMemberAction,
  revokeInviteAction,
  setMemberRoleAction,
} from "@/lib/actions/team";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import { ConfirmDelete, ConfirmDeleteAction } from "@/components/confirm-delete";
import type { TeamRole } from "@/lib/team-rules";

export interface TeamMemberView {
  id: string;
  email: string;
  role: TeamRole;
  isYou: boolean;
}
export interface PendingInviteView {
  id: string;
  email: string;
  role: TeamRole;
}

function useToast(state: ActionState, onOk?: () => void) {
  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      onOk?.();
    } else if (state.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

function MemberRow({ clientId, member }: { clientId: string; member: TeamMemberView }) {
  const [roleState, roleAction, rolePending] = useActionState(
    setMemberRoleAction,
    initialActionState,
  );
  const [removeState, removeAction] = useActionState(removeMemberAction, initialActionState);
  useToast(roleState);
  useToast(removeState);
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {member.email}
          {member.isYou ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
        </p>
      </div>
      <form action={roleAction} className="flex items-center gap-2">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="userId" value={member.id} />
        <NativeSelect
          name="role"
          defaultValue={member.role}
          aria-label={`Role for ${member.email}`}
        >
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </NativeSelect>
        <SubmitButton pending={rolePending}>Save</SubmitButton>
      </form>
      <ConfirmDelete
        title={member.isYou ? "Leave this business?" : `Remove ${member.email}?`}
        description={
          member.isYou
            ? "You'll lose access to this business's portal right away."
            : "They'll lose access to your portal right away. Their calls and replies stay in your history."
        }
        triggerLabel={member.isYou ? "Leave" : `Remove ${member.email}`}
      >
        <form action={removeAction}>
          <input type="hidden" name="clientId" value={clientId} />
          <input type="hidden" name="userId" value={member.id} />
          <ConfirmDeleteAction type="submit">
            {member.isYou ? "Leave" : "Remove"}
          </ConfirmDeleteAction>
        </form>
      </ConfirmDelete>
    </li>
  );
}

function InviteRow({ clientId, invite }: { clientId: string; invite: PendingInviteView }) {
  const [state, action] = useActionState(revokeInviteAction, initialActionState);
  useToast(state);
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{invite.email}</p>
        <p className="text-xs text-muted-foreground">
          Invited as {invite.role === "owner" ? "owner" : "staff"} · waiting to sign up
        </p>
      </div>
      <form action={action}>
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="invitationId" value={invite.id} />
        <Button type="submit" size="sm" variant="outline">
          Cancel invite
        </Button>
      </form>
    </li>
  );
}

/**
 * Settings → Team: who can sign in to this business's portal, and as what.
 * Owner-only page; every action re-checks ownership on the server.
 */
export function TeamAccess({
  clientId,
  members,
  invites,
  invitesReady,
}: {
  clientId: string;
  members: TeamMemberView[];
  invites: PendingInviteView[];
  invitesReady: boolean;
}) {
  const [invite, inviteAction, invitePending] = useActionState(
    inviteStaffAction,
    initialActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useToast(invite, () => formRef.current?.reset());

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>
            Each person gets their own sign-in. <strong>Staff</strong> can use the portal day to day
            — calls, appointments, messages and replies to customers. <strong>Owners</strong> can
            also manage billing, the team, and where alerts go.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitesReady ? (
            <form ref={formRef} action={inviteAction} className="space-y-4">
              <input type="hidden" name="clientId" value={clientId} />
              <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
                <Field label="Email" error={invite.fieldErrors?.email}>
                  <Input
                    name="email"
                    type="email"
                    placeholder="frontdesk@yourbusiness.com"
                    required
                  />
                </Field>
                <Field label="Role" error={invite.fieldErrors?.role}>
                  <NativeSelect name="role" defaultValue="staff">
                    <option value="staff">Staff</option>
                    <option value="owner">Owner</option>
                  </NativeSelect>
                </Field>
              </div>
              <div className="flex justify-end">
                <SubmitButton pending={invitePending}>Send invite</SubmitButton>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              Team invites aren&apos;t switched on yet — contact support.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>People with access</CardTitle>
          <CardDescription>
            Changing someone&apos;s role takes effect on their next page load. Your business always
            keeps at least one owner.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {members.length > 0 ? (
            <ul className="divide-y rounded-lg border">
              {members.map((m) => (
                <MemberRow key={m.id} clientId={clientId} member={m} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No one else has a sign-in yet.</p>
          )}
          {invites.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Pending invites</p>
              <ul className="divide-y rounded-lg border">
                {invites.map((i) => (
                  <InviteRow key={i.id} clientId={clientId} invite={i} />
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
