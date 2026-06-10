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
  Sparkles,
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
  Sparkles,
};

const linkClass = (active: boolean) =>
  cn(
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
  );

export function NavLinks({
  onNavigate,
  superAdmin,
}: {
  onNavigate?: () => void;
  superAdmin?: boolean;
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
            className={linkClass(active)}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
      {superAdmin ? (
        <Link
          href="/platform"
          onClick={onNavigate}
          aria-current={pathname.startsWith("/platform") ? "page" : undefined}
          className={linkClass(pathname.startsWith("/platform"))}
        >
          <Globe className="size-4 shrink-0" />
          Platform
        </Link>
      ) : null}
    </nav>
  );
}

export function AppSidebar({ superAdmin }: { superAdmin?: boolean }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
      <div className="flex h-16 items-center gap-2 border-b px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Phone className="size-4" />
        </div>
        <span className="font-semibold tracking-tight">{APP_NAME}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <NavLinks superAdmin={superAdmin} />
      </div>
    </aside>
  );
}
