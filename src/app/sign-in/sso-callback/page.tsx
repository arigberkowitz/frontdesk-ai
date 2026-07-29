"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

/** Completes the Google OAuth handshake, then redirects to the dashboard. */
export default function SSOCallbackPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <div className="size-6 animate-spin rounded-full border-2 border-border border-t-foreground" />
      <p className="text-sm">Signing you in…</p>
      <AuthenticateWithRedirectCallback
        signInForceRedirectUrl="/"
        signUpForceRedirectUrl="/"
      />
    </div>
  );
}
