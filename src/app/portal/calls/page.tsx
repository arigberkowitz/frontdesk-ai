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
      <CallsTable
        clientId={clientId}
        calls={shown}
        callHref={(id) => `/portal/calls/${id}`}
        timezone={client?.timezone}
        callers={callers}
      />
    </div>
  );
}
