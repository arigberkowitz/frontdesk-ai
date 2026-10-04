"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserMenuButton } from "@/components/user-menu-button";
import { CommandPalette } from "@/components/command-palette";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { BrandMark, NavLinks } from "@/components/app-sidebar";
import { APP_NAME } from "@/config/app";

/** Operator top bar. Light only — there is deliberately no theme toggle. */
export function AppTopbar({
  clients,
  superAdmin,
  reviewCount,
}: {
  clients?: { id: string; name: string }[];
  superAdmin?: boolean;
  reviewCount?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="fd-header sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" />
          }
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-[#f5f6fb]/95 p-0">
          <SheetHeader className="h-16 justify-center border-b px-4">
            <SheetTitle className="flex items-center gap-2.5 font-heading">
              <BrandMark />
              {APP_NAME}
            </SheetTitle>
          </SheetHeader>
          <div className="p-3">
            <NavLinks
              onNavigate={() => setOpen(false)}
              superAdmin={superAdmin}
              reviewCount={reviewCount}
              label="Operator menu"
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Phones: the brand sits in the bar since the rail is hidden. */}
      <div className="flex items-center gap-2 md:hidden">
        <BrandMark className="size-7" />
        <span className="font-heading text-sm font-semibold tracking-tight">{APP_NAME}</span>
      </div>

      <div className="flex-1" />

      <CommandPalette clients={clients} />
      <UserMenuButton />
    </header>
  );
}
