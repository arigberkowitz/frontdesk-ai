"use client";

import { startTransition, useActionState, useOptimistic, useState } from "react";
import Link from "next/link";
import { Check, Copy, PhoneForwarded } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ForwardingCallout } from "@/components/portal/forwarding-callout";
import { ForwardingGuidePicker } from "@/components/portal/forwarding-guide-picker";
import { ForwardingTestPanel } from "@/components/portal/forwarding-test-panel";
import { setAnsweringModeAction } from "@/lib/actions/receptionist";
import { setSetupFlagAction } from "@/lib/actions/setup";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AnsweringMode = "all_calls" | "missed_only";

/**
 * The one place that answers "how do calls actually reach my AI?" — the
 * business's dedicated number, the exact codes to dial (big, at the top), a
 * forwarding on/off switch, a "Test my forwarding" call that proves it works,
 * which mode they want (every call vs. only missed calls), and step-by-step
 * guides for their phone service. The setup checklist's forwarding step
 * deep-links here.
 */
export function AiNumberCard({
  clientId,
  phoneNumber,
  mode,
  forwardingDone,
  isAdmin,
  canEdit,
  businessLine = null,
  verifiedLabel = null,
  canTest = false,
  testAvailable = false,
}: {
  clientId: string;
  phoneNumber: string | null;
  mode: AnsweringMode;
  /** Forwarding is on (owner switched it on, or a test call proved it). */
  forwardingDone: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  /** E.164 of the line customers call (what "Test my forwarding" rings). */
  businessLine?: string | null;
  /** When a test last passed, formatted in the business's time zone. */
  verifiedLabel?: string | null;
  /** Owner or operator: may run the test and change the business line. */
  canTest?: boolean;
  /** Voice calling is set up on this deployment. */
  testAvailable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const pretty = phoneNumber ? formatPhone(phoneNumber) : null;
  const digits = phoneNumber ? phoneNumber.replace(/[^\d+]/g, "") : "";

  const toastResult = (next: ActionState) => {
    if (next.ok && next.message) toast.success(next.message);
    else if (next.error) toast.error(next.error);
    return next;
  };
  const [, modeAction, modePending] = useActionState(
    async (prev: ActionState, fd: FormData) => toastResult(await setAnsweringModeAction(prev, fd)),
    initialActionState,
  );

  // The forwarding switch. It records whether forwarding is set up (the same
  // flag the checklist and the quiet-line alert read); it can't dial anything
  // for the owner, which the text under it says plainly.
  const [on, setOn] = useOptimistic(forwardingDone);
  const [flagPending, setFlagPending] = useState(false);
  const toggleForwarding = (next: boolean) => {
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("flag", "forwardingDone");
    fd.set("value", next ? "true" : "false");
    setFlagPending(true);
    startTransition(async () => {
      setOn(next);
      const res = toastResult(await setSetupFlagAction(initialActionState, fd));
      if (!res.ok) setOn(!next);
      setFlagPending(false);
    });
  };

  return (
    <Card id="forwarding" className="scroll-mt-24">
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
              <PhoneForwarded className="size-4 text-primary" />
              Your AI number
            </h2>
            <p className="text-sm text-muted-foreground">
              The line your AI receptionist answers, 24/7.
            </p>
          </div>
          {pretty ? (
            <div className="flex items-center gap-2">
              <span className="font-heading text-xl font-semibold tabular-nums">{pretty}</span>
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy number"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(digits);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    /* clipboard unavailable */
                  }
                }}
              >
                {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
              </Button>
            </div>
          ) : (
            <span className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
              Not assigned yet
            </span>
          )}
        </div>

        {/* The codes come first: a business that doesn't know them can't use this. */}
        {pretty && phoneNumber ? (
          <ForwardingCallout mode={mode} phoneNumber={phoneNumber} />
        ) : null}

        {/* Forwarding on/off. Same flag as the setup checklist; a passed test
            switches it on by itself. */}
        <div
          data-testid="forwarding-switch-row"
          className={cn(
            "flex items-start justify-between gap-4 rounded-xl border px-4 py-3",
            on ? "border-emerald-300 bg-emerald-50" : "border-amber-300/70 bg-amber-50/60",
          )}
        >
          <div className="min-w-0 text-sm">
            <p id="fwd-switch-label" className="text-base font-semibold">
              Call forwarding is {on ? "on" : "off"}
            </p>
            {pretty ? (
              on ? (
                <p className="text-muted-foreground">
                  {mode === "missed_only"
                    ? "Calls you miss ring through to your AI."
                    : "Calls to your business number ring through to your AI."}{" "}
                  {verifiedLabel ? <>Last test passed {verifiedLabel}.</> : <>Run the test below to make sure.</>}
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Your AI is live on {pretty}, but calls to your business number still ring your
                  phone as usual. Dial the turn-on code above, then switch this on.
                </p>
              )
            ) : (
              <>
                {/* Careful with this sentence. It briefly read "we're assigning
                    one", which promises work that nothing in the system is
                    actually doing — a number is assigned when the receptionist
                    is activated, and if that attempt failed there is nobody
                    queued to retry it. A business reading a promise sits and
                    waits instead of asking. */}
                <p className="text-muted-foreground">
                  <strong>No AI phone number yet.</strong> On a free trial, make one test call to
                  your AI in the browser and its own number is set up when you hang up. The dial-in
                  steps appear here as soon as it is.{" "}
                  <Link href="/portal/guidelines#activate" className="underline underline-offset-2">
                    Go to Your AI
                  </Link>
                  .
                </p>
              </>
            )}
            {pretty ? (
              <p className="mt-1 text-xs text-muted-foreground">
                This switch keeps track of whether you&apos;ve set forwarding up at your phone
                company. It can&apos;t dial for you. To really turn forwarding on or off, dial the
                codes above from your business phone.
              </p>
            ) : null}
          </div>
          {pretty ? (
            <Switch
              aria-labelledby="fwd-switch-label"
              data-testid="forwarding-switch"
              checked={on}
              disabled={!canEdit || flagPending}
              onCheckedChange={toggleForwarding}
              className="mt-1 h-7 w-12 data-[size=default]:h-7 data-[size=default]:w-12 [&>span]:size-6"
            />
          ) : null}
        </div>

        {/* Prove it works. */}
        {pretty ? (
          <ForwardingTestPanel
            clientId={clientId}
            mode={mode}
            businessLine={businessLine}
            verifiedLabel={verifiedLabel}
            canTest={canTest}
            available={testAvailable}
            hasAiNumber={Boolean(phoneNumber)}
          />
        ) : null}

        {/* Mode choice: full receptionist vs. backup. Admin-only. */}
        <div className="space-y-2">
          <p className="text-sm font-medium">When should your AI answer?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  value: "all_calls" as const,
                  title: "Every call",
                  body: "Your 24/7 receptionist — it answers the moment the phone rings.",
                },
                {
                  value: "missed_only" as const,
                  title: "Only calls you miss",
                  body: "You answer when you can; the AI catches busy, no-answer, and after-hours calls.",
                },
              ] as const
            ).map((opt) => (
              <form action={modeAction} key={opt.value}>
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="mode" value={opt.value} />
                <button
                  type="submit"
                  disabled={!isAdmin || modePending || mode === opt.value}
                  className={cn(
                    "w-full rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    mode === opt.value
                      ? "border-primary bg-primary/5"
                      : "hover:border-muted-foreground/40",
                    !isAdmin && "cursor-default opacity-70",
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className={cn(
                        "size-3.5 rounded-full border-[4.5px]",
                        mode === opt.value ? "border-primary" : "border-muted-foreground/30",
                      )}
                    />
                    {opt.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{opt.body}</span>
                </button>
              </form>
            ))}
          </div>
          {!isAdmin ? (
            <p className="text-xs text-muted-foreground">Only your admin can change this.</p>
          ) : null}
        </div>

        {pretty && phoneNumber ? (
          <ForwardingGuidePicker mode={mode} phoneNumber={phoneNumber} />
        ) : (
          <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            The exact dial codes appear here as soon as your AI has its own phone number — they
            include that number, so there&apos;s nothing useful to show until then. Meanwhile your
            AI is ready to talk: try a test call in the browser on the Your AI page.
          </p>
        )}

        <p className="text-sm text-muted-foreground">
          Your website, Google listing, and business cards don&apos;t change — customers keep
          calling the number they already know.
        </p>
      </CardContent>
    </Card>
  );
}
