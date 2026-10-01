import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Inbox, Phone } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { getCallerContext } from "@/lib/data/callers";
import { getThread, markThreadRead } from "@/lib/data/sms-messages";
import { isOptedOut } from "@/lib/data/sms-optouts";
import { hasSmsConsent } from "@/lib/data/sms-consents";
import { stripPhoneNumbers } from "@/lib/appointment-messages";
import { MessageReply } from "@/components/portal/message-reply";
import { messageKindLabel, parseThreadParam } from "@/lib/sms-inbox-view";
import { formatDateTime, formatPhone } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Conversation" };

/**
 * One customer's text thread with this business, oldest → newest.
 *
 * Tenant isolation: the thread is looked up by (session clientId, phone). A
 * phone that only exists under another business simply has no rows here, and
 * renders as not found — nothing about the other business leaks.
 */
export default async function PortalMessageThreadPage({
  params,
}: {
  params: Promise<{ phone: string }>;
}) {
  const { phone: raw } = await params;
  const phone = parseThreadParam(raw);
  if (!phone) notFound();
  const { clientId, preview } = await resolvePortalClient();
  const [client, messages, caller] = await Promise.all([
    getClientByIdUnsafe(clientId),
    getThread(clientId, phone),
    getCallerContext(clientId, phone, null),
  ]);
  if (messages.length === 0) notFound();

  // Opening the thread is reading it — but an operator previewing the portal
  // isn't the owner, so don't clear the owner's unread markers for them.
  if (!preview) await markThreadRead(clientId, phone);

  const tz = client?.timezone ?? undefined;
  const title = caller.name ?? formatPhone(phone);
  const hasAppointment = messages.some((m) => m.appointmentId);
  const hasLead = messages.some((m) => m.leadId);

  // Who may be texted from here — the send action enforces the same rules.
  const customerTexted = messages.some((m) => m.direction === "inbound");
  const [optedOut, consented] = await Promise.all([
    isOptedOut(phone, clientId),
    customerTexted ? Promise.resolve(true) : hasSmsConsent(clientId, phone, "portal_reply"),
  ]);

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        render={<Link href="/portal/messages" />}
        nativeButton={false}
        className="-ml-2"
      >
        <ArrowLeft className="size-4" /> All messages
      </Button>
      <PageHeader
        title={title}
        description={caller.name ? formatPhone(phone) : "Texts with this customer."}
      >
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/portal/calls?from=${encodeURIComponent(phone)}`} />}
          nativeButton={false}
        >
          <Phone className="size-4" /> Calls
        </Button>
        {hasAppointment ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/portal/appointments" />}
            nativeButton={false}
          >
            <CalendarCheck className="size-4" /> Appointments
          </Button>
        ) : null}
        {hasLead ? (
          <Button variant="outline" size="sm" render={<Link href="/portal/leads" />} nativeButton={false}>
            <Inbox className="size-4" /> Leads
          </Button>
        ) : null}
      </PageHeader>

      <Card className="fd-thread">
        <CardContent>
          <ol className="space-y-4">
            {messages.map((m) => {
              const outbound = m.direction === "outbound";
              const label = messageKindLabel(m.kind);
              return (
                <li key={m.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] space-y-1", outbound ? "items-end text-right" : "")}>
                    <div
                      className={cn(
                        "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed",
                        outbound
                          ? "rounded-br-sm bg-indigo-500 text-white"
                          : "rounded-bl-sm bg-muted text-foreground",
                        m.status === "failed"
                          ? "bg-destructive/10 text-foreground ring-1 ring-destructive/40"
                          : outbound
                            ? "fd-bubble-out"
                            : "fd-bubble-in",
                      )}
                    >
                      {m.body}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {outbound ? "Sent" : "Received"}
                      {label ? ` · ${label}` : ""} · {formatDateTime(m.createdAt, tz)}
                      {outbound && m.status === "delivered" ? " · Delivered" : ""}
                    </p>
                    {m.status === "failed" ? (
                      <p className="text-xs text-destructive">
                        Not delivered{m.error ? ` — ${m.error}` : ""}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          {preview ? (
            <p className="text-sm text-muted-foreground">
              You&apos;re previewing this business&apos;s portal — replies can only be sent by the business.
            </p>
          ) : optedOut ? (
            <p className="text-sm text-muted-foreground" role="status">
              <span className="font-medium text-foreground">This customer texted STOP</span>, so you can&apos;t
              text them. They&apos;d have to text START first — you can still call {formatPhone(phone)}.
            </p>
          ) : !consented ? (
            <p className="text-sm text-muted-foreground" role="status">
              This customer hasn&apos;t texted you or agreed to texts from you yet, so you can&apos;t start a
              text conversation here. Give them a call at {formatPhone(phone)} instead.
            </p>
          ) : (
            <MessageReply
              phone={phone}
              businessName={stripPhoneNumbers(client?.name)}
              includeOptOut={!customerTexted}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
