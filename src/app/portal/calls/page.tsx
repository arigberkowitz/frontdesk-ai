import type { Metadata } from "next";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listCalls } from "@/lib/data/calls";
import { listCallerNames } from "@/lib/data/callers";
import { buildCallerIndex, callerKey, callerName, otherParty } from "@/lib/callers";
import { formatPhone } from "@/lib/format";
import { summarizeTurnedAway, turnedAwayLine } from "@/lib/spam";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CallsTable } from "@/components/clients/calls-table";
import { EmptyState } from "@/components/empty-state";
import { CallMeNow } from "@/components/portal/call-me-now";
import { Phone, ShieldCheck } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = { title: "Calls" };

export default async function PortalCallsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const { clientId } = await resolvePortalClient();
  const [client, calls, names] = await Promise.all([
    getClientByIdUnsafe(clientId),
    listCalls(clientId, 500),
    listCallerNames(clientId),
  ]);
  // Built from the full list so "3rd call" is right even when the page is
  // filtered down to one number.
  const callers = buildCallerIndex(calls, names);

  const fromKey = callerKey(from);
  const shown = fromKey ? calls.filter((c) => callerKey(otherParty(c)) === fromKey) : calls;
  const filterName = fromKey ? callerName(callers, from) : null;
  // Calls the spam screen hung up on never get a row here (see recordTurnedAway),
  // so say how many there were instead of letting them vanish.
  const turnedAway = summarizeTurnedAway(client?.setupFlags?.turnedAway, 30);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calls"
        description={
          fromKey
            ? `Every call with ${filterName ? `${filterName} (${formatPhone(from)})` : formatPhone(from)}.`
            : "Every call your AI receptionist answered."
        }
      >
        {fromKey ? (
          <Button variant="outline" size="sm" render={<Link href="/portal/calls" />} nativeButton={false}>
            Show all calls
          </Button>
        ) : null}
      </PageHeader>
      {turnedAway.total > 0 && !fromKey ? (
        <p className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          <span>
            Your AI also turned away{" "}
            <strong className="text-foreground">{turnedAwayLine(turnedAway)}</strong> in the last 30
            days before answering. They used no minutes and aren&apos;t listed below.{" "}
            <Link
              href="/portal?show=blocked#blocked-callers"
              className="font-medium whitespace-nowrap text-foreground underline underline-offset-4"
            >
              See them
            </Link>
          </span>
        </p>
      ) : null}
      {calls.length === 0 && client ? (
        // A brand-new business has no calls because nobody has rung yet — so
        // say the number and offer to ring them, instead of describing what
        // a call log would look like if it had anything in it.
        <EmptyState
          icon={Phone}
          title="No calls yet"
          description={
            client.retellPhoneNumber
              ? `Your AI answers at ${formatPhone(client.retellPhoneNumber)}. Call it from any phone — or have it call you — and the call shows up here with its recording and summary a minute after you hang up.`
              : "Answered calls will appear here with recordings and summaries."
          }
        >
          {client.retellPhoneNumber ? (
            <div className="mx-auto max-w-md text-left">
              <CallMeNow clientId={clientId} defaultPhone={client.escalationNumber} hasNumber />
            </div>
          ) : null}
        </EmptyState>
      ) : (
        <CallsTable
          clientId={clientId}
          calls={shown}
          callHref={(id) => `/portal/calls/${id}`}
          timezone={client?.timezone}
          callers={callers}
        />
      )}
    </div>
  );
}
