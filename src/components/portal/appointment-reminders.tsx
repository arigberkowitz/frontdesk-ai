"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { BellRing, Check, MessageSquare, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { sendReminderAction } from "@/lib/actions/reminders";
import { initialActionState } from "@/lib/actions/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ReminderLog {
  channel: string; // "call" | "sms"
  status: string; // "queued" | "sent" | "failed"
  at: string; // ISO
}

/** Strip formatting so tel: gets something every dialer accepts. */
function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function ReminderButton({
  clientId,
  appointmentId,
  channel,
  disabled,
  children,
}: {
  clientId: string;
  appointmentId: string;
  channel: "sms" | "call";
  disabled?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(sendReminderAction, initialActionState);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Reminder sent.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <input type="hidden" name="channel" value={channel} />
      <Button type="submit" variant="outline" size="sm" disabled={disabled || pending}>
        {children}
      </Button>
    </form>
  );
}

function HistoryRow({ r }: { r: ReminderLog }) {
  const verb = r.channel === "call" ? "Called" : "Texted";
  const when = format(new Date(r.at), "MMM d, h:mm a");
  const Icon = r.channel === "call" ? Phone : MessageSquare;
  return (
    <li className="flex items-center gap-2 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      {r.status === "failed" ? (
        <span className="flex items-center gap-1 text-destructive">
          <X className="size-3.5" /> {verb.replace(/ed$/, "")} failed · {when}
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> {verb} {when}
        </span>
      )}
    </li>
  );
}

/** Reminder controls + per-appointment ping history, shown in the appointment dialog. */
export function AppointmentReminders({
  clientId,
  appointmentId,
  phone,
  reminders,
}: {
  clientId: string;
  appointmentId: string;
  phone: string | null;
  reminders: ReminderLog[];
}) {
  const hasPhone = Boolean(phone && phone.trim());
  // Two-step: first click opens the explicit "right now" choices, so nothing
  // ever sends from a single ambiguous click.
  const [choosing, setChoosing] = useState(false);

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Remind this customer</p>
        <p className="text-xs text-muted-foreground">
          Your AI sends the reminder and notes the time here.
        </p>
      </div>
      {!choosing ? (
        <Button variant="outline" size="sm" disabled={!hasPhone} onClick={() => setChoosing(true)}>
          <BellRing className="size-4" />
          Send a reminder…
        </Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <ReminderButton clientId={clientId} appointmentId={appointmentId} channel="sms" disabled={!hasPhone}>
            <MessageSquare className="size-4" />
            Text right now
          </ReminderButton>
          {/* Outbound calling isn't connected, so this opens YOUR phone rather
              than pretending the AI dialed. A button that logs a call nobody
              made is worse than no button. */}
          <a
            href={hasPhone ? telHref(phone!) : undefined}
            aria-disabled={!hasPhone}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              !hasPhone && "pointer-events-none opacity-50",
            )}
          >
            <Phone className="size-4" />
            Call them yourself
          </a>
          <Button variant="ghost" size="sm" onClick={() => setChoosing(false)}>
            Cancel
          </Button>
        </div>
      )}
      {!hasPhone ? (
        <p className="text-xs text-muted-foreground">No phone number on file for this customer.</p>
      ) : null}
      {reminders.length ? (
        <ul className="space-y-1.5">
          {reminders.map((r, i) => (
            <HistoryRow key={`${r.at}-${i}`} r={r} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No reminders sent yet.</p>
      )}
    </div>
  );
}
