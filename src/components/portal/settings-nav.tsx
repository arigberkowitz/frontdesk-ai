"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
        className="fd-tabs max-w-full overflow-x-auto [scrollbar-width:none] sm:w-fit"
      >
        {sections.map((s) => {
          const active = s.key === current?.key;
          return (
            <Link
              key={s.key}
              href={s.href}
              aria-current={active ? "page" : undefined}
              className="fd-tab"
            >
              {s.label}
            </Link>
          );
        })}
      </nav>
      {current ? <p className="px-1 text-sm text-muted-foreground">{current.description}</p> : null}
    </div>
  );
}
