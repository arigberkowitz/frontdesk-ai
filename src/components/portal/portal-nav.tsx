"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  Clock,
  Inbox,
  LayoutGrid,
  MessagesSquare,
  MoreHorizontal,
  Phone,
  Settings,
  Sparkles,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isPortalNavActive,
  portalNavFor,
  type PortalNavItem,
  type PortalNavKey,
} from "@/config/portal-nav";

const ICONS: Record<PortalNavKey, LucideIcon> = {
  overview: LayoutGrid,
  calls: Phone,
  messages: MessagesSquare,
  leads: Inbox,
  appointments: CalendarDays,
  hours: Clock,
  staff: Users,
  ai: Sparkles,
  services: Wrench,
  knowledge: BookOpen,
  settings: Settings,
};

/** Small count pill for unread customer texts on the Messages item. */
function UnreadPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[11px] font-semibold leading-5 text-white">
      <span className="sr-only">, </span>
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread</span>
    </span>
  );
}

function NavLink({
  item,
  active,
  unreadMessages,
  size = "sm",
}: {
  item: PortalNavItem;
  active: boolean;
  unreadMessages: number;
  size?: "sm" | "lg";
}) {
  const Icon = ICONS[item.key];
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg font-medium transition-colors",
        size === "lg" ? "px-3 py-2.5 text-sm" : "px-2.5 py-1.5 text-sm",
        active
          ? "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
      {item.key === "messages" ? <UnreadPill count={unreadMessages} /> : null}
    </Link>
  );
}

/**
 * Desktop navigation: a quiet left rail, grouped by job. The old header crammed
 * eleven tabs next to the business name, so at a laptop width the last ones
 * (Settings included) were clipped off-screen with no hint they existed.
 *
 * Solo businesses get zero team clutter — Staff only shows when staff mode is
 * on or the business said it has a team at setup.
 */
export function PortalSidebar({
  showTeam = true,
  unreadMessages = 0,
}: {
  showTeam?: boolean;
  unreadMessages?: number;
}) {
  const pathname = usePathname();
  const groups = portalNavFor(showTeam);
  return (
    <nav aria-label="Portal" className="flex flex-col gap-5">
      {groups.map((group, gi) => (
        <div
          key={group.label ?? `g${gi}`}
          className={cn(gi === groups.length - 1 && !group.label && "border-t pt-4")}
        >
          {group.label ? (
            <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  active={isPortalNavActive(pathname, item.href)}
                  unreadMessages={unreadMessages}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The four screens an owner opens from their pocket, plus everything else. */
const BAR: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Overview", href: "/portal", icon: LayoutGrid },
  { label: "Calls", href: "/portal/calls", icon: Phone },
  { label: "Bookings", href: "/portal/appointments", icon: CalendarDays },
  { label: "Leads", href: "/portal/leads", icon: Inbox },
];

/**
 * Phone navigation. Phones have a native answer to a long menu: a bottom tab
 * bar with the four daily screens, and a More sheet — grouped the same way as
 * the desktop rail — for everything else.
 */
export function PortalTabBar({
  showTeam = true,
  unreadMessages = 0,
}: {
  showTeam?: boolean;
  unreadMessages?: number;
}) {
  const pathname = usePathname();
  // The sheet remembers WHERE it was opened; navigating anywhere makes that
  // stale, which closes it — no effect needed, and a sheet can never linger
  // over a page it wasn't opened on.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const moreOpen = openedOn === pathname;
  const setMoreOpen = (open: boolean) => setOpenedOn(open ? pathname : null);

  const moreGroups = portalNavFor(showTeam)
    .map((g) => ({ ...g, items: g.items.filter((i) => !BAR.some((b) => b.href === i.href)) }))
    .filter((g) => g.items.length > 0);
  const moreActive = moreGroups.some((g) =>
    g.items.some((item) => isPortalNavActive(pathname, item.href)),
  );

  return (
    <div className="md:hidden">
      {moreOpen ? (
        <>
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setMoreOpen(false)}
          />
          <div className="fixed inset-x-3 bottom-20 z-50 max-h-[70vh] space-y-3 overflow-y-auto rounded-2xl border bg-card p-2 shadow-xl">
            {moreGroups.map((group, gi) => (
              <div key={group.label ?? `g${gi}`}>
                {group.label ? (
                  <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                    {group.label}
                  </p>
                ) : null}
                {group.items.map((item) => (
                  <NavLink
                    key={item.href}
                    item={item}
                    active={isPortalNavActive(pathname, item.href)}
                    unreadMessages={unreadMessages}
                    size="lg"
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {BAR.map((item) => {
          const active = isPortalNavActive(pathname, item.href) && !moreOpen;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                active ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(!moreOpen)}
          className={cn(
            "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
            moreOpen || moreActive
              ? "text-indigo-600 dark:text-indigo-400"
              : "text-muted-foreground",
          )}
        >
          <span className="relative">
            {moreOpen ? <X className="size-5" /> : <MoreHorizontal className="size-5" />}
            {unreadMessages > 0 && !moreOpen ? (
              <span
                aria-label={`${unreadMessages} unread messages`}
                className="absolute -right-1 -top-0.5 size-2 rounded-full bg-indigo-500"
              />
            ) : null}
          </span>
          More
        </button>
      </nav>
    </div>
  );
}
