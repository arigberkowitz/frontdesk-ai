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
  MessagesSquare,
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
import { SETTINGS_SECTIONS } from "@/config/portal-settings-sections";

interface CmdItem {
  label: string;
  href: string;
  icon: LucideIcon;
  group: string;
}

const PORTAL_ITEMS: CmdItem[] = [
  { label: "Overview", href: "/portal", icon: LayoutDashboard, group: "Go to" },
  { label: "Calls", href: "/portal/calls", icon: Phone, group: "Inbox" },
  { label: "Messages", href: "/portal/messages", icon: MessagesSquare, group: "Inbox" },
  { label: "Leads", href: "/portal/leads", icon: Inbox, group: "Inbox" },
  { label: "Appointments", href: "/portal/appointments", icon: CalendarCheck, group: "Schedule" },
  { label: "Hours & time off", href: "/portal/hours", icon: Clock, group: "Schedule" },
  { label: "Staff", href: "/portal/staff", icon: Users, group: "Schedule" },
  { label: "Your AI", href: "/portal/guidelines", icon: Sparkles, group: "Receptionist" },
  { label: "Services", href: "/portal/services", icon: Wrench, group: "Receptionist" },
  { label: "Knowledge", href: "/portal/knowledge", icon: HelpCircle, group: "Receptionist" },
  ...SETTINGS_SECTIONS.map((s) => ({
    label: s.key === "business" ? "Settings" : `Settings · ${s.label}`,
    href: s.href,
    icon: Settings,
    group: "Settings",
  })),
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
        className="flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:size-10 max-sm:justify-center max-sm:p-0"
        aria-label="Search (Command K)"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="fd-kbd hidden sm:inline-flex">⌘K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="fd-cmd gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>Command menu</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2.5 border-b px-4">
            <Search className="size-4 shrink-0 text-brand" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") go(filtered[0]?.href);
              }}
              placeholder={portal ? "Jump to a page…" : "Jump to a client, page, or action…"}
              className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-80 overflow-auto p-2">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</li>
            ) : (
              filtered.map((item) => (
                <li key={`${item.group}-${item.href}`}>
                  <button
                    type="button"
                    onClick={() => go(item.href)}
                    data-cmd-item
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="fd-cmd-icon" aria-hidden>
                      <item.icon className="size-4" />
                    </span>
                    <span className="flex-1 truncate font-medium">{item.label}</span>
                    <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                      {item.group}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <kbd className="fd-kbd">↵</kbd> open first match
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="fd-kbd">esc</kbd> close
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
