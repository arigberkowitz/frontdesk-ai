"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/** App-level error boundary — a styled retry instead of Next's raw crash page. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          We hit an unexpected error. Please try again in a moment.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset} variant="outline">
          Try again
        </Button>
        <Button variant="ghost" nativeButton={false} render={<Link href="/" />}>
          Go home
        </Button>
      </div>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">If you contact us about this, mention code {error.digest}.</p>
      ) : null}
    </div>
  );
}
