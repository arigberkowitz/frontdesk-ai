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
 * Shown on the "Your AI" page when a business can't activate yet (no plan, no
 * approved trial). Two states: enter the trial code, or waiting for approval.
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your AI receptionist</CardTitle>
        <CardDescription>
          {waiting
            ? "Your free trial is one approval away."
            : "Everything you set up below is saved and ready — activation turns it on."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {waiting ? (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
            <Hourglass className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <p>
              <strong>Trial requested.</strong> We&apos;ll email you the moment it&apos;s approved —
              then come back here and hit Activate. Meanwhile, keep teaching your AI below; it all
              carries over.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(() => action(fd));
            }}
            className="space-y-3"
          >
            <p className="text-sm text-muted-foreground">
              Activation starts with a plan — or a <strong>free trial</strong>: the full product,
              every feature, nothing to pay. Got a trial code from us? Enter it here.
            </p>
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
                {pending ? "Checking…" : "Start my free trial"}
              </Button>
            </div>
            {/* Was a mailto: to a personal Gmail address, printed in full to
                every prospective customer. The in-app form routes to whoever
                actually handles support and arrives with the business already
                attached. */}
            <p className="text-xs text-muted-foreground">
              No code?{" "}
              <Link href="/portal/settings#help" className="underline underline-offset-2">
                Ask us about a trial
              </Link>{" "}
              — or just reply to your welcome email.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
