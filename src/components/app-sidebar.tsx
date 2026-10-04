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

/**
 * Operator nav item. `fd-nav-link` picks up the Signal skin's active pill (a
 * soft violet wash); inside the desktop rail (`nav[aria-label="Operator"]`)
 * the active item also gets the glowing violet→cyan marker on the rail edge.
 * Colors: ink-on-mist inactive (#5B6078 on #F5F6FB, 5.7:1) and brand violet
 * on the active wash (≥6:1) — both WCAG AA.
 */
const linkClass = (active: boolean) =>
  cn(
    "fd-nav-link relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-200 ease-out motion-reduce:transition-none",
    active
      ? "bg-brand-soft text-brand"
      : "text-muted-foreground hover:translate-x-0.5 hover:bg-white/80 hover:text-foreground motion-reduce:hover:translate-x-0",
  );

/** Open QA findings on the Review item: a quiet amber pill, violet when the item is active. */
function ReviewBadge({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none tabular-nums ring-1 ring-inset",
        active
          ? "bg-white text-brand ring-[rgb(106_61_245/0.22)]"
          : "bg-[#fffbeb] text-[#92400e] ring-[rgb(180_83_9/0.22)]",
      )}
    >
      {count > 99 ? "99+" : count}
      <span className="sr-only"> open {count === 1 ? "grade" : "grades"}</span>
    </span>
  );
}

export function NavLinks({
  onNavigate,
  superAdmin,
  reviewCount = 0,
  label = "Operator",
}: {
  onNavigate?: () => void;
  superAdmin?: boolean;
  /** Open QA findings — shown as a badge on the Review item. */
  reviewCount?: number;
  /** Accessible name; the desktop rail uses "Operator" (the CSS marker keys off it). */
  label?: string;
}) {
  const pathname = usePathname();
  const platformActive = pathname.startsWith("/platform");
  return (
    <nav aria-label={label} className="space-y-0.5">
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
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{item.label}</span>
            {item.href === "/review" && reviewCount > 0 ? (
              <ReviewBadge count={reviewCount} active={active} />
            ) : null}
          </Link>
        );
      })}
      {superAdmin ? (
        <>
          <div className="mx-2.5 my-3 h-px bg-border" aria-hidden />
          <Link
            href="/platform"
            onClick={onNavigate}
            aria-current={platformActive ? "page" : undefined}
            className={linkClass(platformActive)}
          >
            <Globe className="size-4 shrink-0" aria-hidden />
            Platform
          </Link>
        </>
      ) : null}
    </nav>
  );
}

/** The brand mark: the Signal gradient tile with a soft glow. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("fd-mark flex size-8 shrink-0 items-center justify-center rounded-lg text-white", className)}
      style={{ background: "linear-gradient(115deg,#6a3df5 0%,#4b56e0 45%,#0e7490 100%)" }}
      aria-hidden
    >
      <Phone className="size-4" />
    </span>
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
    <aside className="fd-op-sidebar hidden w-56 shrink-0 md:block">
      <div className="sticky top-0 flex h-screen flex-col">
        <div className="flex h-16 items-center gap-2.5 px-4">
          <BrandMark />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-heading text-sm font-semibold tracking-tight text-foreground">{APP_NAME}</p>
            <p className="text-[11px] font-medium text-muted-foreground">Operator</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks superAdmin={superAdmin} reviewCount={reviewCount} />
        </div>
      </div>
    </aside>
  );
}
