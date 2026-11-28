import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { SUPPORT_EMAIL, supportMailto } from "@/config/contact";

/**
 * What a business's owner sees when an operator suspended (or deleted) the
 * account. No data, no controls, no reason given on screen — just who to write
 * to. Rendered by the portal layout in place of every page.
 */
export function SuspendedPage({ closed = false, businessName }: { closed?: boolean; businessName?: string | null }) {
  return (
    <div data-fd-app="portal" className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="max-w-md space-y-4">
        <PauseCircle className="mx-auto size-12 text-amber-500" aria-hidden />
        <h1 className="font-heading text-2xl font-semibold">
          {closed ? "This account is closed" : "This account is suspended"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {businessName ? <strong className="text-foreground">{businessName}</strong> : "Your business"}{" "}
          {closed
            ? "has been closed. Calls are no longer answered and nothing more will be charged."
            : "is on hold. Calls aren't being answered by the AI, and no texts or emails are going out."}{" "}
          If you think this is a mistake, write to{" "}
          <Link href={supportMailto("Account suspended")} className="font-medium underline underline-offset-2">
            {SUPPORT_EMAIL}
          </Link>
          .
        </p>
        <p className="text-xs text-muted-foreground">FrontDesk AI</p>
      </div>
    </div>
  );
}
