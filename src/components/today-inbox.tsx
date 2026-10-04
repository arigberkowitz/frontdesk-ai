import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  CircleCheck,
  Hourglass,
  Inbox,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { InboxItem, InboxKind } from "@/lib/today-inbox";

const ICONS: Record<InboxKind, LucideIcon> = {
  unread_sms: MessageSquare,
  new_leads: UserPlus,
  failed_sends: AlertTriangle,
  trial_ending: Hourglass,
  proposed_fixes: Sparkles,
  open_grades: ShieldCheck,
  failed_runs: Bot,
};

function InboxRow({ item }: { item: InboxItem }) {
  const Icon = ICONS[item.kind];
  const showCount = item.kind !== "trial_ending";
  return (
    <li>
      <Link
        href={item.href}
        prefetch={item.href.includes("/preview-portal") ? false : undefined}
        data-tone={item.tone}
        className="fd-inbox-row group outline-none"
      >
        <span className="fd-inbox-icon" aria-hidden>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-foreground">{item.title}</span>
            {item.clientName ? (
              <span className="basis-full truncate text-xs font-medium text-muted-foreground sm:basis-auto sm:text-sm">
                <span className="hidden sm:inline" aria-hidden>· </span>
                {item.clientName}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground sm:block sm:truncate">{item.detail}</span>
        </span>
        {showCount ? (
          <span className="fd-inbox-count" aria-hidden>
            {item.count > 99 ? "99+" : item.count}
          </span>
        ) : null}
        <span className="hidden items-center gap-0.5 text-xs font-semibold text-brand sm:inline-flex">
          {item.cta}
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand motion-reduce:transition-none"
          aria-hidden
        />
      </Link>
    </li>
  );
}

/**
 * "Today" — everything across the portfolio waiting on the operator, each row
 * linking to where it gets done. Replaces the old "N new messages" banner,
 * which only ever counted leads in status `new`.
 */
export function TodayInbox({ items }: { items: InboxItem[] }) {
  return (
    <Card className="fd-today">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand" aria-hidden>
              <Inbox className="size-4" />
            </span>
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-tight">Today</h2>
              <p className="text-sm text-muted-foreground">
                {items.length > 0 ? "What needs you, across every client" : "Your inbox across every client"}
              </p>
            </div>
          </div>
          {items.length > 0 ? (
            <span className="fd-signal-pill" aria-label={`${items.length} ${items.length === 1 ? "item" : "items"} waiting`}>
              {items.length}
            </span>
          ) : null}
        </div>

        {items.length > 0 ? (
          <ul className="mt-4 space-y-2" aria-label="Waiting on you">
            {items.map((item) => (
              <InboxRow key={item.key} item={item} />
            ))}
          </ul>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-[rgb(4_120_87/0.25)] bg-[#ecfdf5]/70 px-4 py-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[#047857] shadow-sm" aria-hidden>
              <CircleCheck className="size-5" />
            </span>
            <div className="text-sm">
              <p className="font-semibold text-[#065f46]">All clear — nothing is waiting on you.</p>
              <p className="text-[#3f5f55]">
                No new leads, unread texts, fixes to approve, grades to review, trials ending or failures this week.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
