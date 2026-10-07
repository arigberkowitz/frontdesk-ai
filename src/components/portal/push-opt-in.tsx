"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing, Smartphone, Share, SquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
  updatePushPreferencesAction,
} from "@/lib/actions/push";
import { deviceLabel } from "@/lib/push-payloads";

export type PushDevice = {
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  notifyTexts: boolean;
  notifyBookings: boolean;
};

/**
 * What this browser can do, worked out after mount (none of it exists on the
 * server). "ios-install" is iPhone/iPad Safari outside a home-screen app:
 * Apple only allows web push for installed apps, so the honest next step is
 * "add it to your Home Screen", not a button that can't work.
 */
type Support = "checking" | "ready" | "ios-install" | "unsupported" | "denied";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function detectSupport(): Exclude<Support, "checking"> {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (ios && !standalone) return "ios-install";
  if (!capable) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ready";
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/portal");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/portal" });
  return navigator.serviceWorker.ready;
}

function since(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function PushOptIn({
  vapidPublicKey,
  devices,
  canManage,
}: {
  vapidPublicKey: string;
  devices: PushDevice[];
  canManage: boolean;
}) {
  const [support, setSupport] = useState<Support>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    (async () => {
      const s = detectSupport();
      let current: string | null = null;
      if (s === "ready") {
        try {
          const reg = await navigator.serviceWorker.getRegistration("/portal");
          const sub = await reg?.pushManager.getSubscription();
          current = sub?.endpoint ?? null;
        } catch {
          current = null;
        }
      }
      if (cancelled) return;
      setSupport(s);
      setEndpoint(current);
    })();
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  const thisDevice = endpoint ? devices.find((d) => d.endpoint === endpoint) ?? null : null;
  const others = devices.filter((d) => d.endpoint !== endpoint);

  function turnOn() {
    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setSupport(permission === "denied" ? "denied" : "ready");
          toast.error("Notifications weren't allowed, so nothing changed.");
          return;
        }
        const reg = await registration();
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
          }));
        const res = await savePushSubscriptionAction(sub.toJSON(), navigator.userAgent);
        if (!res.ok) {
          toast.error(res.error ?? "Couldn't turn notifications on.");
          return;
        }
        setEndpoint(sub.endpoint);
        toast.success(res.message ?? "Notifications are on for this device.");
      } catch {
        toast.error("This browser wouldn't set up notifications. Try again, or use another browser.");
      }
    });
  }

  function turnOff(target: string) {
    startTransition(async () => {
      if (target === endpoint) {
        try {
          const reg = await navigator.serviceWorker.getRegistration("/portal");
          await (await reg?.pushManager.getSubscription())?.unsubscribe();
        } catch {
          // The server row is what matters; the browser one dies on its own.
        }
        setEndpoint(null);
      }
      const res = await removePushSubscriptionAction(target);
      if (res.ok) toast.success(res.message ?? "Turned off.");
      else toast.error(res.error ?? "Couldn't turn that off.");
    });
  }

  function setPref(key: "notifyTexts" | "notifyBookings", value: boolean) {
    if (!endpoint) return;
    startTransition(async () => {
      const res = await updatePushPreferencesAction(endpoint, { [key]: value });
      if (!res.ok) toast.error(res.error ?? "Couldn't save that.");
    });
  }

  function sendTest() {
    if (!endpoint) return;
    startTransition(async () => {
      const res = await sendTestPushAction(endpoint);
      if (res.ok) toast.success(res.message ?? "Sent.");
      else toast.error(res.error ?? "Couldn't send a test.");
    });
  }

  return (
    <Card data-testid="push-opt-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4 text-primary" aria-hidden />
          Phone notifications
        </CardTitle>
        <CardDescription>
          A ping on your phone the moment a customer texts or your AI books someone. Turn it on
          for each phone or computer you use. It shows who, never what they wrote.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canManage ? (
          <p className="text-sm text-muted-foreground">
            Only the account owner can turn on phone notifications.
          </p>
        ) : support === "checking" ? (
          <div className="fd-skel h-10 w-48 rounded-lg" aria-busy="true" />
        ) : support === "ios-install" ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
            <p className="font-medium">On iPhone, add FrontDesk to your Home Screen first</p>
            <ol className="mt-2 space-y-1.5 text-muted-foreground">
              <li className="flex items-center gap-2">
                <Share className="size-4 shrink-0 text-primary" aria-hidden />
                Tap Share in Safari&apos;s toolbar
              </li>
              <li className="flex items-center gap-2">
                <SquarePlus className="size-4 shrink-0 text-primary" aria-hidden />
                Choose <strong className="font-medium text-foreground">Add to Home Screen</strong>
              </li>
              <li className="flex items-center gap-2">
                <Smartphone className="size-4 shrink-0 text-primary" aria-hidden />
                Open FrontDesk from your Home Screen and come back here
              </li>
            </ol>
            <p className="mt-2 text-xs text-muted-foreground">
              Apple only lets installed apps send notifications (iOS 16.4 or later).
            </p>
          </div>
        ) : support === "unsupported" ? (
          <p className="text-sm text-muted-foreground">
            This browser can&apos;t show notifications. Chrome, Edge, Firefox and Safari can.
          </p>
        ) : support === "denied" ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800">
            Notifications are blocked for this site. Allow them in your browser&apos;s site
            settings, then reload this page.
          </p>
        ) : thisDevice ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
                On for this device
              </span>
              <span className="text-sm text-muted-foreground">{deviceLabel(thisDevice.userAgent)}</span>
            </div>
            <div className="divide-y rounded-xl border bg-card/60">
              <label className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>New customer texts</span>
                <Switch
                  defaultChecked={thisDevice.notifyTexts}
                  disabled={pending}
                  onCheckedChange={(v) => setPref("notifyTexts", v)}
                  aria-label="New customer texts"
                />
              </label>
              <label className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm">
                <span>New bookings</span>
                <Switch
                  defaultChecked={thisDevice.notifyBookings}
                  disabled={pending}
                  onCheckedChange={(v) => setPref("notifyBookings", v)}
                  aria-label="New bookings"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={sendTest} disabled={pending}>
                Send a test
              </Button>
              <Button variant="ghost" onClick={() => endpoint && turnOff(endpoint)} disabled={pending}>
                Turn off on this device
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Button onClick={turnOn} disabled={pending}>
              <BellRing className="size-4" aria-hidden />
              Turn on for this device
            </Button>
            <p className="text-xs text-muted-foreground">
              Your browser will ask to allow notifications. Your email and text alerts keep
              working either way.
            </p>
          </div>
        )}

        {canManage && others.length > 0 ? (
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Also on
            </p>
            <ul className="space-y-1.5">
              {others.map((d) => (
                <li key={d.endpoint} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {deviceLabel(d.userAgent)}
                    <span className="text-muted-foreground"> · since {since(d.createdAt)}</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => turnOff(d.endpoint)} disabled={pending}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
