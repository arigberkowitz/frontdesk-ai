"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PhoneCall, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { formatPhone } from "@/lib/format";
import { elapsed } from "@/lib/live-call";

interface Live {
  id: string;
  fromNumber: string | null;
  startAt: string;
  direction: string;
}
interface Ended {
  id: string;
  fromNumber: string | null;
  endAt: string;
  durationSec: number | null;
  outcome: string | null;
}

const POLL_MS = 5_000;
/** How long "that call just ended" stays before the strip goes away. */
const LINGER_MS = 20_000;

/**
 * "Riley is on a call right now."
 *
 * The one thing that proves the product works every time the owner opens the
 * app. Polls while the tab is visible and stops when it isn't — a strip
 * nobody can see shouldn't cost a request every five seconds. When the call
 * ends it turns into a link to that call for a moment, then folds away, so
 * the owner can go straight from "it's happening" to "here's what happened".
 */
export function LiveCallStrip({ clientId }: { clientId: string }) {
  const [live, setLive] = useState<Live | null>(null);
  // `seenAt` is stamped when the ended call first arrives so the strip can
  // fold away LINGER_MS later; it lives in state (not a ref) because the
  // render depends on it.
  const [ended, setEnded] = useState<{ item: Ended; seenAt: number } | null>(null);
  // Wall clock, refreshed once a second while there's something to show.
  const [now, setNow] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/portal/live?client=${encodeURIComponent(clientId)}`, {
            cache: "no-store",
          });
          if (res.ok) {
            const j = (await res.json()) as { live: Live | null; ended: Ended | null };
            setNow(Date.now());
            setLive(j.live);
            if (j.ended && !j.live) {
              const item = j.ended;
              const seenAt = Date.now();
              setEnded((prev) => (prev && prev.item.id === item.id ? prev : { item, seenAt }));
            }
          }
        } catch {
          // A missed poll is nothing; the next one is five seconds away.
        }
      }
      timer = setTimeout(poll, POLL_MS);
    }
    void poll();
    const onVis = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [clientId]);

  // The clock ticks once a second while a call is live (elapsed counter) or
  // an ended call is lingering (so it can expire).
  useEffect(() => {
    if (!live && !ended) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live, ended]);

  const showEnded = !live && ended != null && now > 0 && now - ended.seenAt < LINGER_MS;
  if (!live && !showEnded) return null;

  if (live) {
    const who = live.fromNumber ? formatPhone(live.fromNumber) : "a caller";
    const Icon = live.direction === "outbound" ? PhoneOutgoing : PhoneIncoming;
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm sm:px-6"
      >
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
        </span>
        <Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
        <span>
          <span className="font-medium">On a call right now</span>
          <span className="text-muted-foreground"> with {who}</span>
        </span>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
          {elapsed(new Date(live.startAt), new Date(now || Date.parse(live.startAt)))}
        </span>
      </div>
    );
  }

  const e = ended!.item;
  const who = e.fromNumber ? formatPhone(e.fromNumber) : "a caller";
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b bg-muted/60 px-4 py-2 text-sm sm:px-6"
    >
      <PhoneCall className="size-4 text-muted-foreground" />
      <span>
        <span className="font-medium">Call just ended</span>
        <span className="text-muted-foreground">
          {" "}
          with {who}
          {e.durationSec != null ? ` · ${elapsed(new Date(0), new Date(e.durationSec * 1000))}` : ""}
          {e.outcome ? ` · ${e.outcome.replace(/_/g, " ")}` : ""}
        </span>
      </span>
      <Link
        href={`/portal/calls/${e.id}`}
        className="ml-auto text-xs font-medium underline underline-offset-2"
      >
        See what happened
      </Link>
    </div>
  );
}
