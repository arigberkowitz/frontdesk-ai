"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  // The customer portal is light only (its "Signal" skin has no dark variant),
  // whatever the visitor picked elsewhere or their OS prefers.
  const pathname = usePathname();
  const forcedTheme = pathname?.startsWith("/portal") ? "light" : undefined;
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
