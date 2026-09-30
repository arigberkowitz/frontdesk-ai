"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { sendMessageReplyAction } from "@/lib/actions/messages";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { smsSegments } from "@/lib/lead-followup-text";
import { composeReply, MAX_REPLY_CHARS } from "@/lib/sms-reply";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Reply box at the bottom of a Messages conversation. The server action
 * re-checks everything (tenant, conversation, STOP, consent, caps, length);
 * this only mirrors the length rule and shows what will actually be sent.
 */
export function MessageReply({
  phone,
  businessName,
  includeOptOut,
}: {
  phone: string;
  businessName: string;
  includeOptOut: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState("");
  const [state, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await sendMessageReplyAction(prev, formData);
      if (result.ok) setBody("");
      return result;
    },
    initialActionState,
  );

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Reply sent.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
      router.refresh();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = body.trim();
  const tooLong = trimmed.length > MAX_REPLY_CHARS;
  const outgoing = trimmed ? composeReply(trimmed, { businessName, includeOptOut }) : "";
  const segments = smsSegments(outgoing);
  const prefixed =
    Boolean(trimmed && businessName) && !trimmed.toLowerCase().includes(businessName.toLowerCase());

  return (
    <form ref={formRef} action={action} className="space-y-2">
      <input type="hidden" name="phone" value={phone} />
      <Textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && trimmed && !tooLong && !pending) {
            e.preventDefault();
            formRef.current?.requestSubmit();
          }
        }}
        rows={3}
        placeholder="Type a reply…"
        aria-label="Reply"
        aria-invalid={tooLong || undefined}
        className="text-sm"
        disabled={pending}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-xs", tooLong ? "text-destructive" : "text-muted-foreground")}>
          {trimmed.length} / {MAX_REPLY_CHARS}
          {segments > 0 ? ` · ${segments === 1 ? "1 text" : `${segments} texts`}` : ""}
          {prefixed ? ` · starts with “${businessName}:” so they know it's you` : ""}
          {includeOptOut ? " · “Reply STOP to opt out.” is added" : ""}
        </p>
        <Button type="submit" size="sm" disabled={pending || tooLong || !trimmed}>
          <Send className="size-4" />
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
