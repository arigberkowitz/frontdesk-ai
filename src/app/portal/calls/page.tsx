import type { Metadata } from "next";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listCalls } from "@/lib/data/calls";
import { listCallerNames } from "@/lib/data/callers";
import { buildCallerIndex, callerKey, callerName, otherParty } from "@/lib/callers";
import { formatPhone } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CallsTable } from "@/components/clients/calls-table";
import { EmptyState } from "@/components/empty-state";
import { CallMeNow } from "@/components/portal/call-me-now";
import { Phone } from "lucide-react";
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
