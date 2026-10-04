import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { BillingWarning } from "@/lib/mrr";

/**
 * Small amber notice under the business-health stats: subscriptions whose
 * status disagrees with their client's (a paused client still "active" in
 * Stripe, a live client with no subscription). MRR already excludes them;
 * this says why the number is what it is, and where to fix it.
 */
export function BillingWarnings({ warnings }: { warnings: BillingWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div
      role="note"
      aria-label="Billing warnings"
      className="rounded-xl border border-[rgb(180_83_9/0.22)] bg-[#fffbeb]/80 px-4 py-3 text-sm"
    >
      <p className="flex items-center gap-2 font-semibold text-[#92400e]">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        Billing out of sync for {warnings.length} client{warnings.length === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 space-y-1.5">
        {warnings.map((w) => (
          <li key={`${w.kind}:${w.clientId}`}>
            <Link
              href={`/clients/${w.clientId}?tab=settings`}
              className="group flex items-start gap-1.5 rounded-md text-[#5c3a0f] hover:text-[#3b2405]"
            >
              <span className="min-w-0">
                <span className="font-semibold underline-offset-2 group-hover:underline">{w.clientName}</span>
                <span> — {w.message}</span>
              </span>
              <ChevronRight className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
