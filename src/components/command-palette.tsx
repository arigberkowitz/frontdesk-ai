"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CalendarCheck,
  Clock,
  HelpCircle,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Phone,
  Plus,
  Search,
  Settings,
  Sparkles,
  Wrench, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface CmdItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: string;
}

const PORTAL_ITEMS: CmdItem[] = [
  { label: "Overview", href: "/portal", icon: LayoutDashboard, group: "Go to" },
  { label: "Calls", href: "/portal/calls", icon: Phone, group: "Go to" },
  { label: "Appointments", href: "/portal/appointments", icon: CalendarCheck, group: "Go to" },
  { label: "Leads", href: "/portal/leads", icon: Inbox, group: "Go to" },
  { label: "Services", href: "/portal/services", icon: Wrench, group: "Go to" },
  { label: "Hours", href: "/portal/hours", icon: Clock, group: "Go to" },
  { label: "Knowledge", href: "/portal/knowledge", icon: HelpCircle, group: "Go to" },
  { label: "Team", href: "/portal/team", icon: Users, group: "Go to" },
  { label: "Your AI", href: "/portal/guidelines", icon: Sparkles, group: "Go to" },
  { label: "Settings", href: "/portal/settings", icon: Settings, group: "Go to" },
];

/** ⌘K quick-jump to any page, client, or action. */
export function CommandPalette({
  clients,
  portal,
}: {
  clients?: { id: string; name: string }[];
  portal?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = useMemo<CmdItem[]>(() => {
    if (portal) return PORTAL_ITEMS;
    return [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, group: "Go to" },
      { label: "Clients", href: "/clients", icon: Building2, group: "Go to" },
      { label: "Review", href: "/review", icon: CalendarCheck, group: "Go to" },
      { label: "Growth", href: "/growth", icon: Sparkles, group: "Go to" },
      { label: "Demo", href: "/demo", icon: Phone, group: "Go to" },
      { label: "Settings", href: "/settings", icon: Settings, group: "Go to" },
      { label: "New client", href: "/clients/new", icon: Plus, group: "Actions" },
      ...(clients ?? []).map((c) => ({
        label: c.name,
        href: `/clients/${c.id}`,
        icon: Building2,
        group: "Clients",
      })),
    ];
  }, [clients, portal]);

  const filtered = q
    ? items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()))
    : items;

  function go(href?: string) {
    if (!href) return;
    setOpen(false);
    setQ("");
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Search (Command K)"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border px-1 text-[11px] sm:inline">⌘K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>Command menu</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") go(filtered[0]?.href);
              }}
              placeholder={portal ? "Jump to a page…" : "Jump to a client, page, or action…"}
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-80 overflow-auto p-1.5">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</li>
            ) : (
              filtered.map((item) => (
                <li key={`${item.group}-${item.href}`}>
                  <button
                    type="button"
                    onClick={() => go(item.href)}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <item.icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.group}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
