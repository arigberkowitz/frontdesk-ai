"use client";

import { useState } from "react";
import { Check, Copy, PhoneForwarded } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/format";

/**
 * Shows the business's dedicated AI number and — the part owners always ask
 * about — how it connects to their existing phone presence. The recommended
 * setup keeps their published number everywhere; forwarding quietly routes
 * callers to the AI.
 */
export function AiNumberCard({ phoneNumber }: { phoneNumber: string | null }) {
  const [copied, setCopied] = useState(false);
  const pretty = phoneNumber ? formatPhone(phoneNumber) : null;
  const digits = phoneNumber ? phoneNumber.replace(/[^\d+]/g, "") : "";

  return (
    <Card>
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
              Added once billing is set up
            </span>
          )}
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
          <p className="font-medium">How it connects to your business</p>
          <p className="text-muted-foreground">
            Nothing about your website, Google listing, or business cards has to change. Keep
            advertising the number your customers already know — then pick one of these:
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Forward everything (recommended).</span>{" "}
              From your business phone, dial{" "}
              <code className="rounded bg-muted px-1 tabular-nums">*72 {pretty ?? "your AI number"}</code>{" "}
              (AT&T/T-Mobile:{" "}
              <code className="rounded bg-muted px-1 tabular-nums">**21*{digits || "number"}#</code>).
              Every call to your existing number now rings your AI. Undo anytime with{" "}
              <code className="rounded bg-muted px-1 tabular-nums">*73</code>.
            </li>
            <li>
              <span className="font-medium text-foreground">Catch only missed calls.</span> Ask your
              carrier for “conditional forwarding” to this number — you answer when you can, and the
              AI picks up whatever you miss (busy, no answer, after hours).
            </li>
            <li>
              <span className="font-medium text-foreground">Or publish this number directly.</span>{" "}
              Put it on your website and Google Business Profile as your main line — every call goes
              straight to the AI from day one.
            </li>
          </ol>
          <p className="text-muted-foreground">
            Either way, your AI books, answers questions, takes messages, and alerts you the moment
            something needs a human.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
