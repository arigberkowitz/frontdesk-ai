import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { listCallerNames } from "@/lib/data/callers";
import { listConversations } from "@/lib/data/sms-messages";
import { buildNameIndex, nameFor, previewText } from "@/lib/sms-inbox-view";
import { formatDateTime, formatPhone } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages" };

/**
 * Texts with customers — every confirmation, reminder and follow-up we sent,
 * and every reply that came back, grouped by customer, latest first.
 *
 * Read-only: replying happens from the owner's own phone for now.
 * clientId comes from the session (resolvePortalClient), never the URL.
 */
export default async function PortalMessagesPage() {
  const { clientId } = await resolvePortalClient();
  const [client, conversations, names] = await Promise.all([
    getClientByIdUnsafe(clientId),
    listConversations(clientId),
    listCallerNames(clientId),
  ]);
  const nameIndex = buildNameIndex(names);
  const unreadTotal = conversations.reduce((n, c) => n + c.unread, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        description={
          unreadTotal > 0
            ? `${unreadTotal} new ${unreadTotal === 1 ? "reply" : "replies"} from customers.`
            : "Texts sent to your customers, and their replies."
        }
      />
      {conversations.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No texts yet"
          description="When your AI texts a customer — a booking confirmation, a reminder, a follow-up — the conversation shows up here, along with anything they text back."
        />
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {conversations.map((c) => {
              const name = nameFor(nameIndex, c.customerPhone);
              const unread = c.unread > 0;
              return (
                <li key={c.customerPhone}>
                  <Link
                    href={`/portal/messages/${c.customerPhone}`}
                    // Opening a thread marks it read; a prefetch must not.
                    prefetch={false}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-2 size-2 shrink-0 rounded-full",
                        unread ? "bg-indigo-500" : "bg-transparent",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
                          {name ?? formatPhone(c.customerPhone)}
                          {name ? (
                            <span className="ml-2 font-normal text-muted-foreground">
                              {formatPhone(c.customerPhone)}
                            </span>
                          ) : null}
                        </p>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDateTime(c.lastAt, client?.timezone ?? undefined)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between gap-3">
                        <p
                          className={cn(
                            "truncate text-sm",
                            unread ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {previewText(c.lastBody, c.lastDirection)}
                        </p>
                        {unread ? (
                          <span className="shrink-0 rounded-full bg-indigo-500 px-2 py-0.5 text-xs font-medium text-white">
                            {c.unread} new
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
