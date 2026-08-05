"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Clock, PhoneForwarded, PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { setHandoffModeAction } from "@/lib/actions/spam";
import { initialActionState } from "@/lib/actions/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/format";

export type HandoffMode = "always" | "open_hours" | "never";

const OPTIONS: Array<{
  value: HandoffMode;
  title: string;
  body: string;
  icon: typeof PhoneForwarded;
}> = [
  {
    value: "open_hours",
    title: "Only while you're open",
    body: "Callers get put through during your hours. After hours your AI takes a message instead — nobody's phone rings at 11pm.",
    icon: Clock,
  },
  {
    value: "always",
    title: "Whenever they ask",
    body: "Any caller who asks for a person gets transferred, day or night.",
    icon: PhoneForwarded,
  },
  {
    value: "never",
    title: "Never — take a message",
    body: "Your AI never offers to transfer. It takes a name, number and reason, and says someone will call back.",
    icon: PhoneOff,
  },
];

/**
 * When callers can reach a person.
 *
 * Near the top of settings on purpose. The wrong value here produces the worst
 * call this product can make — a caller who asked for a human, heard "one
 * moment", and got an answering machine — and it's the second most common
 * reason businesses fire an AI phone service. It's also the setting most likely
 * to be wrong by default, because "always" only works if somebody is genuinely
 * always there.
 */
export function HandoffCard({
  clientId,
  mode,
  escalationNumber,
}: {
  clientId: string;
  mode: HandoffMode;
  escalationNumber?: string | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(setHandoffModeAction, initialActionState);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Saved.");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>Can callers reach a person?</CardTitle>
        <CardDescription>
          {escalationNumber
            ? `When your AI puts someone through, it rings ${formatPhone(escalationNumber)}.`
            : "No transfer number is set yet, so your AI takes a message either way."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {OPTIONS.map((opt) => {
          const active = mode === opt.value;
          const Icon = opt.icon;
          return (
            <form key={opt.value} action={action}>
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="mode" value={opt.value} />
              <button
                type="submit"
                disabled={pending || active}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-indigo-500/40 bg-indigo-500/5"
                    : "hover:bg-muted/50 disabled:opacity-60",
                )}
              >
                <Icon
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    active ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {opt.title}
                    {active ? (
                      <span className="ml-2 text-xs font-normal text-indigo-600 dark:text-indigo-400">
                        Current
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{opt.body}</span>
                </span>
              </button>
            </form>
          );
        })}

        {/* The trap this setting exists to prevent, said out loud. */}
        {mode !== "never" && escalationNumber ? (
          <p className="pt-1 text-xs text-muted-foreground">
            Make sure {formatPhone(escalationNumber)} isn&apos;t the same line you forward to your
            AI — a call sent back to a forwarded number loops straight to voicemail.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
