"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const MESSAGES: Record<string, { kind: "success" | "error"; text: string }> = {
  connected: {
    kind: "success",
    text: "Google Calendar connected — new bookings will sync automatically.",
  },
  disconnected: { kind: "success", text: "Google Calendar disconnected." },
  error: { kind: "error", text: "Couldn't connect Google Calendar — please try again." },
};

/**
 * Fires a one-shot toast for the `?calendar=<status>` OAuth redirect, then strips
 * the param so a refresh doesn't replay it. Renders nothing.
 */
export function CalendarStatusToast({ status, returnTo }: { status?: string; returnTo: string }) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (!status || fired.current) return;
    fired.current = true;
    const m = MESSAGES[status];
    if (m) toast[m.kind](m.text);
    router.replace(returnTo);
  }, [status, returnTo, router]);

  return null;
}
