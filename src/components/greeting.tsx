"use client";

import { useSyncExternalStore } from "react";

// Hydration-safe client flag (no setState-in-effect): false on the server and
// first paint, true after mount — so the time-of-day greeting only renders client-side.
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Warm, time-aware greeting. Falls back to a stable label until the client mounts. */
export function Greeting({ name }: { name?: string }) {
  const mounted = useSyncExternalStore(subscribe, onClient, onServer);
  const lead = mounted ? timeGreeting() : "Welcome back";
  return (
    <>
      {lead}
      {name ? `, ${name}` : ""}
    </>
  );
}
