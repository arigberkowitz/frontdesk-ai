"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { MessageSquare, Phone } from "lucide-react";
import { toast } from "sonner";
import { sendLeadFollowupAction } from "@/lib/actions/reminders";
import { initialActionState } from "@/lib/actions/types";
import { Button } from "@/components/ui/button";

export interface FollowupLog {
  channel: string; // "call" | "sms"
  status: string;
  at: string; // ISO
}

function FollowupButton({
  clientId,
  leadId,
  channel,
  disabled,
  children,
}: {
  clientId: string;
  leadId: string;
  channel: "sms" | "call";
  disabled?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(sendLeadFollowupAction, initialActionState);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Follow-up sent.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="channel" value={channel} />
      <Button type="submit" variant="outline" size="sm" disabled={disabled || pending}>
        {children}
      </Button>
    </form>
  );
}

/** One-click outbound follow-up (text/call) for a captured lead, with last-contacted note. */
export function LeadFollowup({
  clientId,
  leadId,
  phone,
  history,
  draft,
}: {
  clientId: string;
  leadId: string;
  phone: string | null;
  history: FollowupLog[];
  /** AI-drafted SMS from the post-call agent; one tap on Text sends exactly this. */
  draft?: string | null;
}) {
  const hasPhone = Boolean(phone && phone.trim());
  const last = history[0];
  return (
    <div className="space-y-2">
      {draft ? (
        <p className="rounded-lg bg-indigo-500/5 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-indigo-600 dark:text-indigo-400">Drafted for you: </span>
          &ldquo;{draft}&rdquo;
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">Follow up:</span>
      <FollowupButton clientId={clientId} leadId={leadId} channel="sms" disabled={!hasPhone}>
        <MessageSquare className="size-3.5" />
        {draft ? "Send text" : "Text"}
      </FollowupButton>
      <FollowupButton clientId={clientId} leadId={leadId} channel="call" disabled={!hasPhone}>
        <Phone className="size-3.5" />
        Call
      </FollowupButton>
      {last ? (
        <span className="text-xs text-muted-foreground">
          · Last {last.channel === "call" ? "called" : "texted"} {format(new Date(last.at), "MMM d, h:mm a")}
        </span>
      ) : !hasPhone ? (
        <span className="text-xs text-muted-foreground">· no number on file</span>
      ) : null}
      </div>
    </div>
  );
}
