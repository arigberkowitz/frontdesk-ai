"use client";

import { useActionState, startTransition } from "react";
import Link from "next/link";
import { Ticket, Hourglass } from "lucide-react";
import { toast } from "sonner";
import { requestTrialAction } from "@/lib/actions/trial";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * "Been given a code?" — one quiet row on the Your AI page.
 *
 * Everyone gets three weeks free just by signing up, so a code is the
 * exception: an extension, or the on-the-house code for someone we know.
 */
export function TrialCodeCard({
  clientId,
  requested,
}: {
  clientId: string;
  requested: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const next = await requestTrialAction(prev, formData);
      if (next.ok) toast.success(next.message ?? "Code accepted!");
      else if (next.error) toast.error(next.error);
      return next;
    },
    initialActionState,
  );
  const waiting = requested || Boolean(state.ok && state.message);

  // The common case has no code — everyone gets three weeks free just by
  // signing up. A full card headed "Your AI receptionist" for the exception
  // made the exception look like the main event, sitting under the plans at
  // full height for every single person. A closed <details> is one quiet line.
  if (!waiting) {
    return (
      <details className="group rounded-xl border bg-card px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <Ticket className="size-4 shrink-0" />
          Been given a code? Enter it here
          <span className="ml-auto text-xs group-open:hidden">Show</span>
          <span className="ml-auto hidden text-xs group-open:inline">Hide</span>
        </summary>
        <div className="mt-3 border-t pt-3">
          <CodeForm clientId={clientId} action={action} pending={pending} />
        </div>
      </details>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your AI receptionist</CardTitle>
        <CardDescription>Your free trial is one approval away.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <Hourglass className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            <strong>Trial requested.</strong> We&apos;ll email you the moment it&apos;s approved —
            then come back here and hit Activate. Meanwhile, keep teaching your AI below; it all
            carries over.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** The code entry itself — shared by the collapsed row and (formerly) the card. */
function CodeForm({
  clientId,
  action,
  pending,
}: {
  clientId: string;
  action: (fd: FormData) => void;
  pending: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
      className="space-y-3"
    >
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex gap-2">
        <Input
          name="code"
          placeholder="FD-XXXXXX"
          autoComplete="off"
          className="max-w-45 font-mono uppercase"
          required
        />
        <Button type="submit" disabled={pending}>
          <Ticket className="size-4" />
          {pending ? "Checking…" : "Redeem code"}
        </Button>
      </div>
      {/* Was a mailto: to a personal Gmail address, printed in full to
          every prospective customer. The in-app form routes to whoever
          actually handles support and arrives with the business already
          attached. */}
      <p className="text-xs text-muted-foreground">
        No code? You don&apos;t need one — pick a plan above.{" "}
        <Link href="/contact" className="underline underline-offset-2">
          Get in touch
        </Link>{" "}
        if you&apos;d rather talk to someone first.
      </p>
    </form>
  );
}
