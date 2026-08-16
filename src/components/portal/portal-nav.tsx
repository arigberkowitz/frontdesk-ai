"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  LayoutGrid,
  MessageSquare,
  MoreHorizontal,
  Phone,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { label: "Overview", href: "/portal" },
  { label: "Calls", href: "/portal/calls" },
  { label: "Appointments", href: "/portal/appointments" },
  { label: "Leads", href: "/portal/leads" },
  { label: "Team", href: "/portal/team" },
  { label: "Services", href: "/portal/services" },
  { label: "Hours", href: "/portal/hours" },
  { label: "Knowledge", href: "/portal/knowledge" },
  { label: "Your AI", href: "/portal/guidelines" },
  { label: "Settings", href: "/portal/settings" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/portal" ? pathname === "/portal" : pathname.startsWith(href);
}

/** Solo businesses get zero team clutter — the Team tab only shows when staff
 *  mode is on or the business said it has a team at setup. */
export function PortalNav({ showTeam = true }: { showTeam?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 hidden items-center gap-1 overflow-x-auto px-1 md:flex">
      {ITEMS.filter((item) => showTeam || item.href !== "/portal/team").map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3",
              active
                ? "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The four screens an owner opens from their pocket, plus everything else. */
const BAR = [
  { label: "Overview", href: "/portal", icon: LayoutGrid },
  { label: "Calls", href: "/portal/calls", icon: Phone },
  { label: "Bookings", href: "/portal/appointments", icon: CalendarDays },
  { label: "Leads", href: "/portal/leads", icon: MessageSquare },
];

/**
 * Phone navigation. On a 390px screen the header used to squeeze ten
 * scrolling tabs between the business name and three icon buttons — about one
 * tab visible, nine invisible, no hint they existed. Phones have a native
 * answer: a bottom tab bar with the four daily screens, and a More sheet for
 * the setup pages you visit once a month.
 */
export function PortalTabBar({ showTeam = true }: { showTeam?: boolean }) {
  const pathname = usePathname();
  // The sheet remembers WHERE it was opened; navigating anywhere makes that
  // stale, which closes it — no effect needed, and a sheet can never linger
  // over a page it wasn't opened on.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const moreOpen = openedOn === pathname;
  const setMoreOpen = (open: boolean) => setOpenedOn(open ? pathname : null);

  const moreItems = ITEMS.filter(
    (item) =>
      !BAR.some((b) => b.href === item.href) && (showTeam || item.href !== "/portal/team"),
  );
  const moreActive = moreItems.some((item) => isActive(pathname, item.href));

  return (
    <div className="md:hidden">
      {moreOpen ? (
        <>
          <button
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setMoreOpen(false)}
          />
          <div className="fixed inset-x-3 bottom-20 z-50 rounded-2xl border bg-card p-2 shadow-xl">
            {moreItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "block rounded-xl px-4 py-3 text-sm font-medium",
                    active
                      ? "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {BAR.map((item) => {
          const active = isActive(pathname, item.href) && !moreOpen;
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
          {moreOpen ? <X className="size-5" /> : <MoreHorizontal className="size-5" />}
          More
        </button>
      </nav>
    </div>
  );
}
