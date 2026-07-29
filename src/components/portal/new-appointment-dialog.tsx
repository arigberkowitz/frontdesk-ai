"use client";

import { useActionState, useState } from "react";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { createManualAppointmentAction } from "@/lib/actions/appointments";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { NativeSelect } from "@/components/form/native-select";
import { SubmitButton } from "@/components/form/submit-button";

export interface ApptServiceOption {
  id: string;
  name: string;
  durationMin: number | null;
}

export interface ApptProviderOption {
  id: string;
  name: string;
}

/**
 * Manual appointment entry — walk-ins, regulars, calls the owner took
 * themselves. The AI books most things; this covers everything else.
 */
export function NewAppointmentDialog({
  clientId,
  services,
  providers,
  vocab,
}: {
  clientId: string;
  services: ApptServiceOption[];
  /** Empty unless staff mode is on. */
  providers: ApptProviderOption[];
  vocab: { customer: string; appointment: string };
}) {
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  // Wrap the server action so success can toast + close from the transition
  // itself (an effect calling setState here trips react-hooks/set-state-in-effect).
  const [state, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const next = await createManualAppointmentAction(prev, formData);
      if (next.ok) {
        if (next.message) toast.success(next.message);
        setOpen(false);
      }
      return next;
    },
    initialActionState,
  );

  const selected = services.find((s) => s.id === serviceId);
  const today = new Date();
  const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <CalendarPlus className="size-4" />
            New {vocab.appointment}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a {vocab.appointment}</DialogTitle>
          <DialogDescription>
            For walk-ins and bookings you took yourself — your AI receptionist adds its own.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-3">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${vocab.customer[0].toUpperCase()}${vocab.customer.slice(1)} name`} error={state.fieldErrors?.customerName}>
              <Input name="customerName" placeholder="Jamie Rivera" autoComplete="off" />
            </Field>
            <Field label="Phone" error={state.fieldErrors?.customerPhone}>
              <Input name="customerPhone" type="tel" placeholder="(555) 010-1234" autoComplete="off" />
            </Field>
          </div>
          {services.length > 0 ? (
            <Field label="Service">
              <NativeSelect
                name="serviceId"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="">Something else</option>
              </NativeSelect>
            </Field>
          ) : null}
          {providers.length > 0 ? (
            <Field label="With">
              <NativeSelect name="providerId" defaultValue="">
                <option value="">Anyone</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date" className="col-span-1" error={state.fieldErrors?.date}>
              <Input name="date" type="date" defaultValue={defaultDate} required />
            </Field>
            <Field label="Time" error={state.fieldErrors?.time}>
              <Input name="time" type="time" required />
            </Field>
            <Field label="Minutes" error={state.fieldErrors?.durationMin}>
              <Input
                name="durationMin"
                type="number"
                min={5}
                max={480}
                step={5}
                placeholder={String(selected?.durationMin ?? 30)}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="allowOverlap" className="size-3.5 accent-primary" />
            Book anyway, even if the time clashes with another {vocab.appointment}
          </label>
          {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
          <SubmitButton pending={pending} className="w-full">
            Add {vocab.appointment}
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
