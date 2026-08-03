"use client";

import { useActionState, useState } from "react";
import { Check, CheckCircle2, Circle, Copy, PhoneForwarded } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/form/submit-button";
import { setAnsweringModeAction } from "@/lib/actions/receptionist";
import { setSetupFlagAction } from "@/lib/actions/setup";
import { initialActionState, type ActionState } from "@/lib/actions/types";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AnsweringMode = "all_calls" | "missed_only";

/**
 * The one place that answers "how do calls actually reach my AI?" — the
 * business's dedicated number, whether forwarding is set up (on/off), which
 * mode they want (every call vs. only missed calls), and the exact dial codes
 * for that mode. The setup checklist's forwarding step deep-links here.
 */
export function AiNumberCard({
  clientId,
  phoneNumber,
  mode,
  forwardingDone,
  isAdmin,
  canEdit,
}: {
  clientId: string;
  phoneNumber: string | null;
  mode: AnsweringMode;
  /** Owner confirmed forwarding is set up (drives the on/off status). */
  forwardingDone: boolean;
  isAdmin: boolean;
  canEdit: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const pretty = phoneNumber ? formatPhone(phoneNumber) : null;
  const digits = phoneNumber ? phoneNumber.replace(/[^\d+]/g, "") : "";
  /**
   * What you actually key in after a star code. Landline/VoIP switches expect a
   * plain 10-digit number — a leading "+1" makes the switch reject the code — so
   * strip the country code for US numbers. GSM codes (**21*…#) are the opposite
   * and want the full international form, so those keep `digits`.
   */
  const dialDigits = (() => {
    const bare = digits.replace(/\D/g, "");
    return bare.length === 11 && bare.startsWith("1") ? bare.slice(1) : bare;
  })();

  const toastResult = (next: ActionState) => {
    if (next.ok && next.message) toast.success(next.message);
    else if (next.error) toast.error(next.error);
    return next;
  };
  const [, modeAction, modePending] = useActionState(
    async (prev: ActionState, fd: FormData) => toastResult(await setAnsweringModeAction(prev, fd)),
    initialActionState,
  );
  const [, flagAction, flagPending] = useActionState(
    async (prev: ActionState, fd: FormData) => toastResult(await setSetupFlagAction(prev, fd)),
    initialActionState,
  );

  const code = (s: string) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-medium tabular-nums text-foreground">{s}</code>
  );

  /**
   * Tap-to-dial. On a phone this opens the dialer pre-filled, so forwarding is
   * one tap instead of a code retyped from memory. On a desktop browser a `tel:`
   * link usually does nothing — hence the codes stay visible as text above, and
   * the hint below tells people which device to be holding.
   *
   * `*` and `#` must be percent-encoded or some dialers silently drop the rest
   * of the string.
   */
  const dialHref = (seq: string) => `tel:${seq.replace(/\*/g, "%2A").replace(/#/g, "%23")}`;
  const DialButton = ({ seq, label }: { seq: string; label: string }) => (
    <a
      href={dialHref(seq)}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "tabular-nums")}
    >
      <PhoneForwarded className="size-3.5" />
      {label}
    </a>
  );

  return (
    <Card id="forwarding" className="scroll-mt-24">
      <CardContent className="space-y-4">
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

        {/* On/off at a glance — driven by the same flag as the setup checklist.
            Three genuinely different situations, so three different messages:
            forwarding live, forwarding off but a number exists, no number yet. */}
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            forwardingDone
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
          )}
        >
          {forwardingDone ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <Circle className="mt-0.5 size-4 shrink-0" />
          )}
          <span>
            {forwardingDone ? (
              <>
                <strong>Forwarding is on.</strong> Calls to your business number ring through to
                your AI.
              </>
            ) : pretty ? (
              <>
                <strong>Forwarding is off.</strong> Your AI is live on {pretty} and ready to answer
                — but calls to your own business number still ring your phone as usual. Switch it on
                below: it&apos;s one quick call from your business phone.
              </>
            ) : (
              <>
                <strong>No AI phone number yet.</strong> Your AI is fully built and you can talk to
                it right now with a test call in the browser — it just has no phone line of its own
                to answer on. We&apos;re assigning one; the dial-in steps appear here the moment
                it&apos;s ready.
              </>
            )}
          </span>
        </div>

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

        {/* Exactly one instruction block — the steps for the chosen mode. */}
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
          <p className="font-medium">
            {mode === "missed_only" ? "Set up missed-call forwarding" : "Set up call forwarding"}
          </p>
          {pretty ? (
            mode === "missed_only" ? (
              <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                <li>
                  From your business phone, dial {code(`*90 ${pretty}`)} (forwards when you&apos;re on
                  the line), then {code(`*92 ${pretty}`)} (forwards when you don&apos;t pick up).
                  AT&T/T-Mobile: {code(`*67*${digits}#`)} and {code(`*61*${digits}#`)}.
                </li>
                <li>
                  Not working? Call your carrier and say: <em>&quot;Forward my busy and unanswered
                  calls to {pretty}.&quot;</em> They&apos;ll switch it on from their side.
                </li>
                <li>
                  Test it: call your business number and don&apos;t pick up — your AI should answer
                  after a few rings.
                </li>
                <li>
                  Turn it off anytime: dial {code("*91")} and {code("*93")}.
                </li>
              </ol>
            ) : (
              <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
                <li>
                  From your business phone, dial {code(`*72 ${pretty}`)} and wait for the
                  confirmation tone, then hang up. AT&T/T-Mobile: {code(`**21*${digits}#`)}.
                </li>
                <li>
                  Test it: call your business number from any other phone — your AI should answer
                  right away.
                </li>
                <li>Change your mind anytime: dial {code("*73")} to turn forwarding off.</li>
              </ol>
            )
          ) : (
            <p className="text-muted-foreground">
              The exact dial codes appear here as soon as your AI has its own phone number — they
              include that number, so there&apos;s nothing useful to show until then. Meanwhile your
              AI is ready to talk: try a test call in the browser on the Your AI page.
            </p>
          )}

          {/* One tap instead of a retyped code. Same sequences as the steps above. */}
          {pretty ? (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-2">
                {mode === "missed_only" ? (
                  <>
                    <DialButton seq={`*90${dialDigits}`} label={`Dial *90 ${pretty}`} />
                    <DialButton seq={`*92${dialDigits}`} label={`Dial *92 ${pretty}`} />
                    <DialButton seq="*91" label="Turn off (*91)" />
                    <DialButton seq="*93" label="Turn off (*93)" />
                  </>
                ) : (
                  <>
                    <DialButton seq={`*72${dialDigits}`} label={`Dial *72 ${pretty}`} />
                    <DialButton seq="*73" label="Turn forwarding off (*73)" />
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Open this page on your business phone and tap a button — it fills the dialer for
                you. The codes have to be dialed from that phone; dialing them from any other line
                won&apos;t do anything.
              </p>
            </div>
          ) : null}

          <p className="text-muted-foreground">
            Your website, Google listing, and business cards don&apos;t change — customers keep
            calling the number they already know.
          </p>
          {canEdit && pretty ? (
            <form action={flagAction}>
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="flag" value="forwardingDone" />
              <input type="hidden" name="value" value={forwardingDone ? "false" : "true"} />
              <SubmitButton
                pending={flagPending}
                variant={forwardingDone ? "outline" : "default"}
                size="sm"
              >
                {forwardingDone ? "Mark as not set up" : "I've set this up"}
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
