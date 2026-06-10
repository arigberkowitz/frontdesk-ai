"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createServiceAction,
  deleteServiceAction,
  updateServiceAction,
} from "@/lib/actions/services";
import { initialActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
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
      toast.success(service ? "Service updated" : "Service added");
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
      <Field label="Description">
        <Textarea name="description" rows={2} defaultValue={service?.description ?? ""} />
      </Field>
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

export function ServicesTab({ clientId, services }: { clientId: string; services: Service[] }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ServiceDialog clientId={clientId} />
      </div>
      {services.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No services yet"
          description="Add the services callers can book so the AI can offer and schedule them."
        />
      ) : (
        <ul className="divide-y rounded-xl border">
          {services.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium">
                  {s.name}
                  {!s.isActive ? <span className="ml-2 text-xs text-muted-foreground">(inactive)</span> : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  {s.durationMin} min{s.priceCents != null ? ` · ${formatCurrencyCents(s.priceCents)}` : ""}
                  {s.description ? ` · ${s.description}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <ServiceDialog clientId={clientId} service={s} />
                <form action={deleteServiceAction}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="serviceId" value={s.id} />
                  <Button variant="ghost" size="icon" type="submit" aria-label="Delete service">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
