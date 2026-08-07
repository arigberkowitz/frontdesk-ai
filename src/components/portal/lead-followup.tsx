"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Copy, MessageSquare, PhoneOutgoing } from "lucide-react";
import { toast } from "sonner";
import { sendLeadFollowupAction } from "@/lib/actions/reminders";
import { callLeadWithAiAction } from "@/lib/actions/outbound";
import { initialActionState } from "@/lib/actions/types";
import {
  confirmReplyText,
  genericFollowUpText,
  MAX_BODY_CHARS,
  OPT_OUT_LINE,
  smsSegments,
} from "@/lib/lead-followup-text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface FollowupLog {
  channel: string; // "call" | "sms"
  status: string;
  at: string; // ISO
}

/**
 * Write the text before it goes.
 *
 * This used to be one button that sent an AI-drafted message on a single tap,
 * in the business's name, to a real customer, with nobody having read it. The
 * draft that ended that arrangement promised "our team will call you shortly
 * to confirm" — a commitment the model invented on the business's behalf.
 *
 * The opt-out line sits below the box rather than inside it: it is always sent,
 * appended on the server, and there is no version of this screen where somebody
 * can delete it by accident.
 */
function Composer({
  clientId,
  leadId,
  businessName,
  customerName,
  service,
  timing,
  draft,
  onClose,
}: {
  clientId: string;
  leadId: string;
  businessName: string;
  customerName: string | null;
  service: string | null;
  timing: string | null;
  draft: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(sendLeadFollowupAction, initialActionState);
  const ctx = useMemo(
    () => ({ businessName, customerName, service, timing }),
    [businessName, customerName, service, timing],
  );
  const opening = draft?.trim() || genericFollowUpText(ctx);
  const [body, setBody] = useState(opening);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Text sent.");
      onClose();
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const segments = smsSegments(body.trim() ? `${body.trim()} ${OPT_OUT_LINE}` : "");
  const tooLong = body.trim().length > MAX_BODY_CHARS;

  return (
    <form action={action} className="space-y-2 rounded-lg border p-3">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="channel" value="sms" />
      <input type="hidden" name="body" value={body} />

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        aria-label="Message"
        className="text-sm"
      />

      <p className="text-xs text-muted-foreground">
        &ldquo;{OPT_OUT_LINE}&rdquo; is added automatically.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {/* Asks for an answer instead of promising a phone call. Their reply
            comes back to you and pauses the automated follow-ups. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setBody(confirmReplyText(ctx))}
        >
          Confirm — reply YES/NO
        </Button>
        {draft?.trim() && body !== draft.trim() ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setBody(draft.trim())}>
            Back to the draft
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className={cn("text-xs", tooLong ? "text-destructive" : "text-muted-foreground")}>
          {body.trim().length} characters ·{" "}
          {segments === 1 ? "1 text" : `${segments} texts`}
          {tooLong ? ` · max ${MAX_BODY_CHARS}` : ""}
        </span>
        <span className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || tooLong || !body.trim()}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </span>
      </div>
    </form>
  );
}

/**
 * "Have your AI call them."
 *
 * The receptionist rings the lead from the business's own number, using the
 * agent they already trained — so the person sees the business calling back,
 * not an unknown mobile.
 */
function AiCallButton({
  clientId,
  leadId,
  disabled,
}: {
  clientId: string;
  leadId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(callLeadWithAiAction, initialActionState);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Calling now.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="leadId" value={leadId} />
      <Button type="submit" variant="outline" size="sm" disabled={disabled || pending}>
        <PhoneOutgoing className="size-3.5" />
        {pending ? "Dialing…" : "AI calls them"}
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
  businessName,
  customerName,
  service,
  timing,
}: {
  clientId: string;
  leadId: string;
  phone: string | null;
  history: FollowupLog[];
  /** AI-drafted SMS from the post-call agent; it opens the composer pre-filled. */
  draft?: string | null;
  businessName: string;
  customerName?: string | null;
  /** What they asked for and when — used by the confirm template. */
  service?: string | null;
  timing?: string | null;
}) {
  const [composing, setComposing] = useState(false);
  const hasPhone = Boolean(phone && phone.trim());
  // Only a send that actually left the building counts as contact. This took
  // history[0] whatever its status, so a text that failed still read "Last
  // texted 8:37 PM" — and a business that believes it already reached someone
  // stops chasing them. A failure is worth showing, but as a failure.
  const last = history.find((h) => h.status === "sent");
  const lastFailure = last ? null : history.find((h) => h.status === "failed");

  if (composing && hasPhone) {
    return (
      <Composer
        clientId={clientId}
        leadId={leadId}
        businessName={businessName}
        customerName={customerName ?? null}
        service={service ?? null}
        timing={timing ?? null}
        draft={draft ?? null}
        onClose={() => setComposing(false)}
      />
    );
  }

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
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasPhone}
          onClick={() => setComposing(true)}
        >
          <MessageSquare className="size-3.5" />
          {draft ? "Write the text" : "Text"}
        </Button>
        {/* Was a tel: link, which on a laptop opens a dialog offering to launch
            an app that isn't installed, and never placed a call anywhere. Two
            honest options instead: the AI rings them, or you take the number
            and ring them yourself. */}
        <AiCallButton clientId={clientId} leadId={leadId} disabled={!hasPhone} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!hasPhone}
          onClick={() => {
            navigator.clipboard?.writeText(phone!.replace(/[^\d+]/g, ""));
            toast.success(`Copied ${phone} — dial it from your phone.`);
          }}
        >
          <Copy className="size-3.5" />
          I&apos;ll call
        </Button>
        {last ? (
          <span className="text-xs text-muted-foreground">
            · Last {last.channel === "call" ? "called" : "texted"}{" "}
            {format(new Date(last.at), "MMM d, h:mm a")}
          </span>
        ) : lastFailure ? (
          <span className="text-xs text-amber-600 dark:text-amber-500">
            · Text didn&apos;t go through {format(new Date(lastFailure.at), "MMM d, h:mm a")} — they
            haven&apos;t heard from you
          </span>
        ) : !hasPhone ? (
          <span className="text-xs text-muted-foreground">· no number on file</span>
        ) : null}
      </div>
    </div>
  );
}
