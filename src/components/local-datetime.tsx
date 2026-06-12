"use client";

import { useSyncExternalStore } from "react";

// Server components don't know the viewer's timezone, so a date formatted there
// renders in UTC and reads as "wrong" to the viewer. This formats in the browser's
// own timezone after mount. useSyncExternalStore keeps SSR/hydration in sync (it
// returns the server snapshot during hydration, then re-renders on the client).
const subscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function LocalDateTime({ iso, className }: { iso: string; className?: string }) {
  const mounted = useMounted();
  const d = new Date(iso);
  const text = mounted
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(d)
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(d);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
