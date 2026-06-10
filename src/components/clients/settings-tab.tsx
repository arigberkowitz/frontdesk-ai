"use client";

import { useActionState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteClientAction,
  inviteClientViewerAction,
  setClientStatusAction,
  updateClientProfileAction,
} from "@/lib/actions/clients";
import { initialActionState } from "@/lib/actions/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";
import { CLIENT_STATUSES, INDUSTRIES, STATUS_LABELS, TIMEZONES } from "@/config/options";
import type { Client } from "@/db/schema";

export function SettingsTab({ client }: { client: Client }) {
  const [profile, profileAction, profilePending] = useActionState(
    updateClientProfileAction,
    initialActionState,
  );
  const [status, statusAction, statusPending] = useActionState(
    setClientStatusAction,
    initialActionState,
  );
  const [invite, inviteAction, invitePending] = useActionState(
    inviteClientViewerAction,
    initialActionState,
  );

  useEffect(() => {
    if (profile.ok) toast.success("Profile saved");
    else if (profile.error) toast.error(profile.error);
  }, [profile]);
  useEffect(() => {
    if (status.ok) toast.success("Status updated");
    else if (status.error) toast.error(status.error);
  }, [status]);
  useEffect(() => {
    if (invite.ok) toast.success("Portal invite sent");
    else if (invite.error) toast.error(invite.error);
  }, [invite]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={profileAction} className="space-y-4">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Business name" error={profile.fieldErrors?.name}>
              <Input name="name" defaultValue={client.name} required />
            </Field>
            <Field label="Website" error={profile.fieldErrors?.websiteUrl}>
              <Input name="websiteUrl" type="url" defaultValue={client.websiteUrl ?? ""} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Industry">
                <NativeSelect name="industry" defaultValue={client.industry ?? ""}>
                  <option value="">Select…</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Timezone">
                <NativeSelect name="timezone" defaultValue={client.timezone}>
                  {TIMEZONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field label="Address">
              <Textarea name="address" rows={2} defaultValue={client.address ?? ""} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Escalation number" hint="Owner alerts + transfers">
                <Input name="escalationNumber" defaultValue={client.escalationNumber ?? ""} />
              </Field>
              <Field label="Forwarding number" hint="Client's existing line">
                <Input name="forwardingNumber" defaultValue={client.forwardingNumber ?? ""} />
              </Field>
            </div>
            <Field
              label="Owner email"
              hint="Where new booking + message alerts are emailed"
              error={profile.fieldErrors?.ownerEmail}
            >
              <Input
                name="ownerEmail"
                type="email"
                defaultValue={client.ownerEmail ?? ""}
                placeholder="owner@business.com"
              />
            </Field>
            <div className="flex justify-end">
              <SubmitButton pending={profilePending}>Save profile</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            Going live or to trial requires a provisioned agent + phone number.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={statusAction} className="flex items-end gap-3">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Lifecycle" className="w-48">
              <NativeSelect name="status" defaultValue={client.status}>
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <SubmitButton pending={statusPending} variant="outline">
              Update status
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client portal</CardTitle>
          <CardDescription>
            Invite the owner to a read-only portal — ROI, calls, and appointments only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={inviteAction} className="flex items-end gap-3">
            <input type="hidden" name="clientId" value={client.id} />
            <Field label="Owner email" className="flex-1" error={invite.fieldErrors?.email}>
              <Input name="email" type="email" placeholder="owner@business.com" />
            </Field>
            <SubmitButton pending={invitePending} variant="outline">
              Send invite
            </SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Soft-deletes the client and hides it from your book.</CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="outline" className="text-destructive">
                  <Trash2 className="size-4" />
                  Delete client
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {client.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This hides the client and its data from your dashboard. This can be undone in the
                  database but not from the UI.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <form action={deleteClientAction}>
                  <input type="hidden" name="clientId" value={client.id} />
                  <AlertDialogAction type="submit">Delete</AlertDialogAction>
                </form>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
