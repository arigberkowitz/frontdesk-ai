"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { activityPingAction } from "@/lib/actions/activity-ping";

const PREF_KEY = "fdai_live_alerts"; // "on" | "off"; unset = on (prompt shown)
const POLL_MS = 45_000;

/**
 * Live desktop alerts for every call/booking while the portal is open in any
 * tab. On by default (new owners want proof the system works); one click turns
 * it off, and the preference sticks per device. Uses the browser Notification
 * API — no data leaves the session.
 */
/** localStorage-backed store: hydration-safe and syncs across open tabs. */
const listeners = new Set<() => void>();
const prefStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    window.addEventListener("storage", cb);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", cb);
    };
  },
  get: () => localStorage.getItem(PREF_KEY) ?? "on",
  set(value: string) {
    localStorage.setItem(PREF_KEY, value);
    listeners.forEach((cb) => cb());
  },
};

export function LiveAlerts() {
  const pref = useSyncExternalStore(prefStore.subscribe, prefStore.get, () => null);
  const sinceRef = useRef(new Date().toISOString());

  useEffect(() => {
    if (pref !== "on") return;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    const id = setInterval(async () => {
      try {
        const ping = await activityPingAction(sinceRef.current);
        sinceRef.current = ping.now;
        for (const e of ping.events) {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(e.title, { body: e.body });
          } else {
            toast(e.title, { description: e.body });
          }
        }
      } catch {
        /* transient — next poll retries */
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pref]);

  if (pref === null) return null;

  const on = pref === "on";
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={() => {
        const next = on ? "off" : "on";
        prefStore.set(next);
        toast.success(next === "on" ? "Live alerts on — you'll see every call." : "Live alerts off.");
      }}
    >
      {on ? <Bell className="size-4" /> : <BellOff className="size-4" />}
      {on ? "Live alerts on" : "Live alerts off"}
    </Button>
  );
}
