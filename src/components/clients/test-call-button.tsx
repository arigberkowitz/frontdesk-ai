"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Phone, PhoneOff } from "lucide-react";
import type { RetellWebClient } from "retell-client-js-sdk";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEFAULT_AGENT_NAME } from "@/lib/prompt";

type CallState = "idle" | "connecting" | "active";

/**
 * In-browser test call (§B6): creates a Retell web call against the client's
 * agent and talks to it via the mic — no phone number needed.
 */
export function TestCallButton({
  clientId,
  agentName = DEFAULT_AGENT_NAME,
}: {
  clientId: string;
  agentName?: string;
}) {
  const [state, setState] = useState<CallState>("idle");
  const [agentTalking, setAgentTalking] = useState(false);
  const clientRef = useRef<RetellWebClient | null>(null);

  useEffect(() => {
    return () => clientRef.current?.stopCall();
  }, []);

  async function start() {
    setState("connecting");
    try {
      const res = await fetch(`/api/clients/${clientId}/test-call`, { method: "POST" });
      const data = (await res.json()) as { accessToken?: string; error?: string };
      if (!res.ok || !data.accessToken) {
        throw new Error(data.error || "Could not start the call.");
      }

      const { RetellWebClient } = await import("retell-client-js-sdk");
      const rc = new RetellWebClient();
      clientRef.current = rc;
      rc.on("call_started", () => setState("active"));
      rc.on("call_ended", () => {
        setState("idle");
        setAgentTalking(false);
      });
      rc.on("agent_start_talking", () => setAgentTalking(true));
      rc.on("agent_stop_talking", () => setAgentTalking(false));
      rc.on("error", (e: unknown) => {
        toast.error(`Call error: ${e instanceof Error ? e.message : "unknown"}`);
        rc.stopCall();
        setState("idle");
      });

      await rc.startCall({ accessToken: data.accessToken });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start the call.");
      setState("idle");
    }
  }

  function end() {
    clientRef.current?.stopCall();
    setState("idle");
    setAgentTalking(false);
  }

  if (state === "idle") {
    return (
      <Button onClick={start} variant="outline">
        <Phone className="size-4" />
        Test call in browser
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
      {state === "connecting" ? (
        <>
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
          <span className="text-sm">Connecting — allow microphone access…</span>
        </>
      ) : (
        <>
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
              agentTalking
                ? "animate-pulse bg-primary text-primary-foreground"
                : "bg-emerald-500/15 text-emerald-600",
            )}
          >
            <Mic className="size-4" />
          </span>
          <span className="text-sm font-medium">
            {agentTalking ? `${agentName} is speaking…` : "Listening — go ahead and talk"}
          </span>
        </>
      )}
      <Button onClick={end} variant="destructive" size="sm" className="ml-auto">
        <PhoneOff className="size-4" />
        End
      </Button>
    </div>
  );
}
