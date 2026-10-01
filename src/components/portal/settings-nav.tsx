"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { SettingsSection } from "@/config/portal-settings-sections";

/** Settings section tabs. Scrolls sideways on a phone rather than wrapping. */
export function SettingsNav({ sections }: { sections: SettingsSection[] }) {
  const pathname = usePathname();
  const current =
    sections.find((s) => s.href !== "/portal/settings" && pathname.startsWith(s.href)) ??
    sections.find((s) => s.href === "/portal/settings");
  return (
    <div className="space-y-3">
      <nav
        aria-label="Settings sections"
        className="-mx-1 flex gap-1 overflow-x-auto border-b px-1 [scrollbar-width:none]"
      >
        {sections.map((s) => {
          const active = s.key === current?.key;
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px shrink-0 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-200",
                active
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
      {current ? <p className="text-sm text-muted-foreground">{current.description}</p> : null}
    </div>
  );
}
