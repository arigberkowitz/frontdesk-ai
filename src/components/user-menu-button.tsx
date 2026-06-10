"use client";

import { useSyncExternalStore } from "react";
import { UserButton } from "@clerk/nextjs";

// Hydration-safe "are we on the client yet?" — returns false during SSR and the
// first client render, then true. No setState-in-effect, so it stays lint-clean.
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Clerk's `UserButton`, rendered only after the first client paint.
 *
 * The widget mounts its own DOM subtree (a `data-clerk-component` node), and the
 * page header is a frequent target for browser extensions that inject markup
 * before React hydrates — both of which cause SSR/CSR hydration mismatches.
 * Deferring to a client-only render makes the server and first client paint
 * identical (a neutral placeholder), so hydration can't diverge here.
 */
export function UserMenuButton() {
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted) {
    return <div className="size-7 rounded-full bg-muted" aria-hidden="true" />;
  }
  return <UserButton />;
}
