"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarCheck,
  Globe,
  Inbox,
  LayoutDashboard,
  Phone,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME, OPERATOR_NAV, type NavIcon } from "@/config/app";

const ICONS: Record<NavIcon, LucideIcon> = {
  LayoutDashboard,
  Building2,
  Inbox,
  Settings,
  Phone,
  CalendarCheck,
  ShieldCheck,
  Sparkles,
  TrendingUp,
};

const linkClass = (active: boolean, dark?: boolean) =>
  cn(
    "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
    dark
      ? active
        ? "bg-indigo-500/20 text-white"
        : "text-zinc-400 hover:bg-white/5 hover:text-white"
      : active
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
  );

/** Slim brand tick marking the active item — quieter than a filled background alone. */
const ActiveTick = ({ dark }: { dark?: boolean }) => (
  <span
    aria-hidden
    className={cn(
      "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full",
      dark ? "bg-indigo-400" : "bg-indigo-500",
    )}
  />
);

export function NavLinks({
  onNavigate,
  superAdmin,
  dark,
  reviewCount = 0,
}: {
  onNavigate?: () => void;
  superAdmin?: boolean;
  dark?: boolean;
  /** Open QA findings — shown as a badge on the Review item. */
  reviewCount?: number;
}) {
  const pathname = usePathname();
  return (
    <nav className="space-y-1">
      {OPERATOR_NAV.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={linkClass(active, dark)}
          >
            {active ? <ActiveTick dark={dark} /> : null}
            <Icon className="size-4 shrink-0" />
            {item.label}
            {item.href === "/review" && reviewCount > 0 ? (
              <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {reviewCount > 99 ? "99+" : reviewCount}
              </span>
            ) : null}
          </Link>
        );
      })}
      {superAdmin ? (
        <Link
          href="/platform"
          onClick={onNavigate}
          aria-current={pathname.startsWith("/platform") ? "page" : undefined}
          className={linkClass(pathname.startsWith("/platform"), dark)}
        >
          {pathname.startsWith("/platform") ? <ActiveTick dark={dark} /> : null}
          <Globe className="size-4 shrink-0" />
          Platform
        </Link>
      ) : null}
    </nav>
  );
}

export function AppSidebar({
  superAdmin,
  reviewCount,
}: {
  superAdmin?: boolean;
  reviewCount?: number;
}) {
  return (
    <aside className="hidden w-52 shrink-0 flex-col border-r border-white/5 bg-[#11131c] md:flex">
      <div className="flex h-16 items-center gap-2.5 border-b border-white/5 px-4">
        <div
          className="flex size-7 items-center justify-center rounded-lg text-white"
          style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
        >
          <Phone className="size-4" />
        </div>
        <span className="font-heading font-semibold tracking-tight text-white">{APP_NAME}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <NavLinks superAdmin={superAdmin} dark reviewCount={reviewCount} />
      </div>
    </aside>
  );
}
