"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { label: "Overview", href: "/portal" },
  { label: "Calls", href: "/portal/calls" },
  { label: "Appointments", href: "/portal/appointments" },
  { label: "Leads", href: "/portal/leads" },
  { label: "Services", href: "/portal/services" },
  { label: "Hours", href: "/portal/hours" },
  { label: "FAQ", href: "/portal/knowledge" },
  { label: "Your AI", href: "/portal/guidelines" },
  { label: "Settings", href: "/portal/settings" },
  { label: "Demo", href: "/portal/demo" },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex items-center gap-1 overflow-x-auto px-1">
      {ITEMS.map((item) => {
        const active =
          item.href === "/portal" ? pathname === "/portal" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
