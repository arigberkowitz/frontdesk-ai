"use client";

import { useActionState, useEffect, useState } from "react";
import { Clock, Pencil, Plus, Users, Video } from "lucide-react";
import { toast } from "sonner";
import {
  createServiceAction,
  deleteServiceAction,
  updateServiceAction,
} from "@/lib/actions/services";
import { initialActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import { ConfirmDelete, ConfirmDeleteAction } from "@/components/confirm-delete";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import { EmptyState } from "@/components/empty-state";
import { formatCurrencyCents } from "@/lib/format";
import type { Service } from "@/db/schema";
import { Wrench } from "lucide-react";

function ServiceForm({
  clientId,
  service,
  onDone,
}: {
  clientId: string;
  service?: Service;
  onDone: () => void;
}) {
  const action = service ? updateServiceAction : createServiceAction;
  const [state, formAction, pending] = useActionState(action, initialActionState);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? (service ? "Service updated" : "Service added"));
      onDone();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="clientId" value={clientId} />
      {service ? <input type="hidden" name="serviceId" value={service.id} /> : null}
      <Field label="Name" error={state.fieldErrors?.name}>
        <Input name="name" defaultValue={service?.name} required placeholder="Teeth cleaning" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Duration (min)" error={state.fieldErrors?.durationMin}>
          <Input name="durationMin" type="number" min={5} step={5} defaultValue={service?.durationMin ?? 30} />
        </Field>
        <Field label="Price ($)" error={state.fieldErrors?.priceDollars}>
          <Input
            name="priceDollars"
            type="number"
            min={0}
            step="0.01"
            defaultValue={service?.priceCents != null ? service.priceCents / 100 : ""}
            placeholder="120"
          />
        </Field>
      </div>
      <Field
        label="People who can do this at the same time"
        hint="1 = no overlapping bookings for this service. If two barbers cut hair, set 2 — the AI can then book two haircuts in the same slot."
        error={state.fieldErrors?.providerCount}
      >
        <Input
          name="providerCount"
          type="number"
          min={1}
          max={50}
          defaultValue={service?.providerCount ?? 1}
        />
      </Field>
      <Field label="Description">
        <Textarea name="description" rows={2} defaultValue={service?.description ?? ""} />
      </Field>
      <div className="flex items-center gap-2">
        <Switch id="virtualOk" name="virtualOk" defaultChecked={service?.virtualOk ?? false} />
        <Label htmlFor="virtualOk">Can be done by video (adds a Meet/Teams link when booked)</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="isActive" name="isActive" defaultChecked={service?.isActive ?? true} />
        <Label htmlFor="isActive">Active (offered for booking)</Label>
      </div>
      <div className="flex justify-end">
        <SubmitButton pending={pending}>{service ? "Save changes" : "Add service"}</SubmitButton>
      </div>
    </form>
  );
}

function ServiceDialog({ clientId, service }: { clientId: string; service?: Service }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          service ? (
            <Button variant="ghost" size="icon" aria-label="Edit service">
              <Pencil className="size-4" />
            </Button>
          ) : (
            <Button>
              <Plus className="size-4" />
              Add service
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{service ? "Edit service" : "Add service"}</DialogTitle>
        </DialogHeader>
        {open ? (
          <ServiceForm clientId={clientId} service={service} onDone={() => setOpen(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** "$1,000" reads as a fee; "Free" reads as an invitation. Render the price
 *  the way the AI quotes it on a call. */
function PriceTag({ cents }: { cents: number | null }) {
  if (cents == null) return null;
  if (cents === 0) {
    return (
      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
        Free
      </span>
    );
  }
  return (
    <span className="font-heading text-xl font-semibold tracking-tight">
      {formatCurrencyCents(cents)}
    </span>
  );
}

export function ServicesTab({ clientId, services }: { clientId: string; services: Service[] }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {services.length > 0
            ? `${services.length} service${services.length === 1 ? "" : "s"} — your AI offers these and quotes these prices on every call.`
            : ""}
        </p>
        <ServiceDialog clientId={clientId} />
      </div>
      {services.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No services yet"
          description="Add the services callers can book so the AI can offer and schedule them."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {services.map((s) => (
            <li
              key={s.id}
              className={`fd-lift group flex flex-col rounded-2xl border bg-card p-5 ${
                !s.isActive ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-medium text-base">
                  {s.name}
                  {!s.isActive ? (
                    <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 align-middle text-xs font-medium text-amber-600 dark:text-amber-400">
                      Paused
                    </span>
                  ) : null}
                </p>
                {/* Quiet until you look at the card — the page is for reading
                    your menu, not for staring at rows of pencils. */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-45 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <ServiceDialog clientId={clientId} service={s} />
                  <ConfirmDelete
                    title={`Delete ${s.name}?`}
                    description="Your receptionist will stop offering this service and quoting its price. Existing appointments keep it."
                    triggerLabel={`Delete ${s.name}`}
                  >
                    <form action={deleteServiceAction}>
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="serviceId" value={s.id} />
                      <ConfirmDeleteAction type="submit">Delete</ConfirmDeleteAction>
                    </form>
                  </ConfirmDelete>
                </div>
              </div>

              {s.description ? (
                <p className="mb-4 mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {s.description}
                </p>
              ) : (
                <div className="mb-4" />
              )}

              <div className="mt-auto flex items-center justify-between gap-2 border-t pt-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <Clock className="size-3.5" />
                    {s.durationMin} min
                  </span>
                  {s.virtualOk ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-600 dark:text-sky-400">
                      <Video className="size-3.5" />
                      Video OK
                    </span>
                  ) : null}
                  {(s.providerCount ?? 1) > 1 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                      <Users className="size-3.5" />
                      {s.providerCount} at once
                    </span>
                  ) : null}
                </div>
                <PriceTag cents={s.priceCents} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
