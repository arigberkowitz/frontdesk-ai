import Link from "next/link";
import { CheckCircle2, Circle, CreditCard, ListChecks, Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Your number is reserved once you add a card or finish setup."
 *
 * A self-serve business gets its receptionist at signup but not its phone
 * number (number-gate.ts). This says so plainly and shows both ways to unlock
 * it, with the setup steps still open, so nobody sits waiting for a number
 * that isn't coming on its own.
 */
export function NumberReserved({
  stepsLeft,
  plansHref = "/portal/guidelines?plans=open#plans",
}: {
  stepsLeft: { key: string; label: string; href: string }[];
  plansHref?: string;
}) {
  return (
    <div
      role="status"
      className="rounded-xl border border-brand/25 bg-brand-soft/60 p-4 text-sm"
      data-testid="number-reserved"
    >
      <p className="flex items-center gap-2 font-medium">
        <Lock className="size-4 shrink-0 text-brand" />
        Your number is reserved once you add a card or finish setup
      </p>
      <p className="mt-1 text-muted-foreground">
        Your AI is built and you can talk to it in your browser right now. Its own phone line is
        assigned the moment you do either of these — whichever comes first.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-background/80 p-3">
          <p className="flex items-center gap-1.5 font-medium">
            <CreditCard className="size-4 text-brand" /> Add a card
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick a plan and your number is assigned as soon as payment goes through.
          </p>
          <Link
            href={plansHref}
            className={cn(buttonVariants({ size: "sm" }), "fd-cta-glow mt-2.5")}
          >
            Add a card
          </Link>
        </div>
        <div className="rounded-lg border bg-background/80 p-3">
          <p className="flex items-center gap-1.5 font-medium">
            <ListChecks className="size-4 text-brand" /> Finish setup
          </p>
          {stepsLeft.length === 0 ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="size-3.5" /> Done — press Get my phone number.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {stepsLeft.length === 1 ? "One step left:" : `${stepsLeft.length} steps left:`}
              </p>
              <ul className="mt-1.5 space-y-1">
                {stepsLeft.map((s) => (
                  <li key={s.key}>
                    <Link
                      href={s.href}
                      className="flex items-center gap-1.5 text-xs underline-offset-2 hover:underline"
                    >
                      <Circle className="size-3 shrink-0 text-muted-foreground" />
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
