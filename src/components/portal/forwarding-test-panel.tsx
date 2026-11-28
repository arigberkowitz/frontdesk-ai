"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PhoneCall, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/form/submit-button";
import {
  checkForwardingTestAction,
  saveBusinessLineAction,
  startForwardingTestAction,
} from "@/lib/actions/forwarding";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import type { ForwardingTestView } from "@/lib/forwarding-test";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

const POLL_MS = 2_000;
/** Give up polling a bit after the longest wait the server allows. */
const MAX_POLL_MS = 3 * 60_000;

/**
 * "Test my forwarding": rings the business's real line from our number and
 * shows Pass or Fail. On a pass the server also switches forwarding on and
 * stamps when it was verified.
 */
export function ForwardingTestPanel({
  clientId,
  mode,
  businessLine,
  verifiedLabel,
  canTest,
  available,
  hasAiNumber,
}: {
  clientId: string;
  mode: "all_calls" | "missed_only";
  /** E.164 of the line customers call, or null. */
  businessLine: string | null;
  /** "Nov 27, 6:10 PM" in the business's time zone, when a test last passed. */
  verifiedLabel: string | null;
  canTest: boolean;
  /** Twilio calling is set up on this deployment. */
  available: boolean;
  hasAiNumber: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<ForwardingTestView | null>(null);
  const [starting, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const [lineState, saveLine, savingLine] = useActionState(
    async (prev: ActionState, fd: FormData) => {
      const next = await saveBusinessLineAction(prev, fd);
      if (next.ok) {
        toast.success(next.message ?? "Saved.");
        setEditing(false);
        setView(null);
        router.refresh();
      } else if (next.error) toast.error(next.error);
      return next;
    },
    initialActionState,
  );

  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const poll = (testId: string, since: number) => {
    timer.current = setTimeout(async () => {
      if (stopped.current) return;
      let next: ForwardingTestView | null = null;
      try {
        next = await checkForwardingTestAction(clientId, testId);
      } catch {
        next = null;
      }
      if (stopped.current) return;
      if (!next) {
        setView(null);
        toast.error("We lost track of that test. Tap Test my forwarding to run it again.");
        return;
      }
      setView(next);
      if (next.status === "pending") {
        if (Date.now() - since < MAX_POLL_MS) poll(testId, since);
      } else if (next.status === "passed") {
        router.refresh();
      }
    }, POLL_MS);
  };

  const start = () => {
    setView(null);
    const fd = new FormData();
    fd.set("clientId", clientId);
    startTransition(async () => {
      const res = await startForwardingTestAction(initialActionState, fd);
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't start the test.");
        return;
      }
      const { testId } = res.data as { testId: string; waitMs: number };
      setView({
        id: testId,
        status: "pending",
        mode,
        headline: mode === "missed_only" ? "Calling your business line. Don't pick up." : "Calling your business line…",
        detail:
          mode === "missed_only"
            ? "Let it ring. The test passes when the call forwards to your AI after your phone goes unanswered. This can take up to a minute and a half."
            : "Your business phone may ring once. You don't need to answer.",
        steps: [],
        remainingMs: 0,
      });
      poll(testId, Date.now());
    });
  };

  const pending = view?.status === "pending" || starting;
  const showLineForm = canTest && (!businessLine || editing);

  return (
    <section
      id="forwarding-test"
      data-testid="forwarding-test"
      className="scroll-mt-24 space-y-3 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold">Test my forwarding</h3>
          <p className="text-sm text-muted-foreground">
            {mode === "missed_only"
              ? "We ring your business number and wait. Don't pick up: it only passes if the call forwards to your AI."
              : "We ring your business number and check the call arrives at your AI. It takes about 15 seconds."}
          </p>
        </div>
        {verifiedLabel ? (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            Verified {verifiedLabel}
          </span>
        ) : null}
      </div>

      {showLineForm ? (
        <form action={saveLine} className="space-y-2">
          <input type="hidden" name="clientId" value={clientId} />
          <label htmlFor="business-line" className="text-sm font-medium">
            Your business phone number
          </label>
          <p className="text-xs text-muted-foreground">
            The number customers call: the one on your Google listing and website. Not your AI
            number.
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <Input
              id="business-line"
              name="businessLine"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(415) 555-0100"
              defaultValue={businessLine ? formatPhone(businessLine) : ""}
              className="h-10 max-w-60"
              aria-invalid={Boolean(lineState.fieldErrors?.businessLine)}
            />
            <SubmitButton pending={savingLine} size="lg" className="h-10">
              Save number
            </SubmitButton>
            {businessLine ? (
              <Button type="button" variant="ghost" size="lg" className="h-10" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
          {lineState.fieldErrors?.businessLine ? (
            <p role="alert" className="text-sm text-destructive">
              {lineState.fieldErrors.businessLine[0]}
            </p>
          ) : null}
        </form>
      ) : businessLine ? (
        <p className="text-sm">
          Business number:{" "}
          <span className="font-medium tabular-nums">{formatPhone(businessLine)}</span>
          {canTest ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Change
            </button>
          ) : null}
        </p>
      ) : null}

      {!hasAiNumber ? (
        <p className="text-sm text-muted-foreground">
          The test is available once your AI has its own phone number.
        </p>
      ) : !canTest ? (
        <p className="text-sm text-muted-foreground">Only the business owner can run this test.</p>
      ) : !available ? (
        <p className="text-sm text-muted-foreground">
          The forwarding test isn&apos;t switched on yet. Ask support and we&apos;ll turn it on.
        </p>
      ) : businessLine && !showLineForm ? (
        <div>
          <Button
            type="button"
            size="lg"
            className="h-11 px-5 text-base"
            onClick={start}
            disabled={pending}
            data-testid="forwarding-test-button"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <PhoneCall className="size-4" />}
            {pending ? "Testing…" : view ? "Test again" : "Test my forwarding"}
          </Button>
        </div>
      ) : null}

      {view ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="forwarding-test-result"
          data-status={view.status}
          className={cn(
            "space-y-2 rounded-lg border px-4 py-3 text-sm",
            view.status === "passed" && "border-emerald-300 bg-emerald-50 text-emerald-900",
            view.status === "failed" && "border-red-300 bg-red-50 text-red-900",
            view.status === "pending" && "border-border bg-muted/40",
          )}
        >
          <p className="flex items-start gap-2 text-base font-semibold">
            {view.status === "passed" ? (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
            ) : view.status === "failed" ? (
              <XCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
            ) : (
              <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground" />
            )}
            {view.headline}
          </p>
          <p>{view.detail}</p>
          {view.status === "failed" && view.steps.length > 0 ? (
            <div>
              <p className="font-medium">What to do</p>
              <ol className="list-decimal space-y-1 pl-5">
                {view.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
