"use client";

import { useState } from "react";
import { Menu, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserMenuButton } from "@/components/user-menu-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavLinks } from "@/components/app-sidebar";
import { APP_NAME } from "@/config/app";

export function AppTopbar({ clients }: { clients?: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" />
          }
        >
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="h-16 justify-center border-b px-5">
            <SheetTitle className="flex items-center gap-2">
              <Phone className="size-4" />
              {APP_NAME}
            </SheetTitle>
          </SheetHeader>
          <div className="p-3">
            <NavLinks onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex-1" />

      <CommandPalette clients={clients} />
      <ThemeToggle />
      <UserMenuButton />
    </header>
  );
}
