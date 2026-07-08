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
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
    dark
      ? active
        ? "bg-indigo-500/25 text-white"
        : "text-zinc-400 hover:bg-white/5 hover:text-white"
      : active
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
  );

export function NavLinks({
  onNavigate,
  superAdmin,
  dark,
}: {
  onNavigate?: () => void;
  superAdmin?: boolean;
  dark?: boolean;
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
          className={linkClass(pathname.startsWith("/platform"), dark)}
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
        <NavLinks superAdmin={superAdmin} dark />
      </div>
    </aside>
  );
}
