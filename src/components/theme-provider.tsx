"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";
import { isLightOnlyPath } from "@/lib/theme-routes";

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  // The app (customer portal + operator pages) is light only: its "Signal"
  // skin has no dark variant, whatever the visitor picked elsewhere or their OS
  // prefers. See isLightOnlyPath for the exact routes.
  const pathname = usePathname();
  const forcedTheme = isLightOnlyPath(pathname) ? "light" : undefined;
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      forcedTheme={forcedTheme}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
