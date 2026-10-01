"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bot, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setThreadAiAction } from "@/lib/actions/sms-ai";
import { initialActionState } from "@/lib/actions/types";

/** Per-conversation AI status line with a Pause AI / Resume AI button. */
export function ThreadAiControl({
  phone,
  status,
  detail,
  canResume,
  canPause,
}: {
  phone: string;
  status: string;
  detail?: string | null;
  canResume: boolean;
  canPause: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(setThreadAiAction, initialActionState);
  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      router.refresh();
    } else if (state.error) toast.error(state.error);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-wrap items-center justify-between gap-3" role="status">
      <div className="flex items-start gap-2 text-sm">
        <Bot className="mt-0.5 size-4 shrink-0 text-indigo-500" aria-hidden />
        <div>
          <p className="font-medium">{status}</p>
          {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
        </div>
      </div>
      {canPause || canResume ? (
        <form action={action}>
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="mode" value={canResume ? "resume" : "pause"} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {canResume ? <Play className="size-4" /> : <Pause className="size-4" />}
            {canResume ? "Resume AI" : "Pause AI"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
