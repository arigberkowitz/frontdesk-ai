import Link from "next/link";
import { Phone } from "lucide-react";
import { resolvePortalClient } from "@/lib/auth-guard";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { PortalNav } from "@/components/portal/portal-nav";
import { UserMenuButton } from "@/components/user-menu-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette } from "@/components/command-palette";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { clientId, preview } = await resolvePortalClient();
  const client = await getClientByIdUnsafe(clientId);

  return (
    <div className="flex min-h-screen flex-col">
      {preview ? (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-800 dark:text-amber-300 sm:px-6">
          <span>
            Operator preview — this is the portal exactly as{" "}
            <strong>{client?.name ?? "this client"}</strong> sees it (their data only).
          </span>
          <Link
            href="/exit-preview"
            className="shrink-0 font-medium underline underline-offset-2"
            prefetch={false}
          >
            Exit preview
          </Link>
        </div>
      ) : null}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur sm:px-6">
        <div
          className="flex size-8 items-center justify-center rounded-lg text-white"
          style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
        >
          <Phone className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-heading text-sm font-semibold leading-tight">
            {client?.name ?? "Your business"}
          </p>
          <p className="text-xs text-muted-foreground leading-tight">FrontDesk AI</p>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <PortalNav />
          <CommandPalette portal />
          <ThemeToggle />
          <UserMenuButton />
        </div>
      </header>
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="fd-fade-up mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
