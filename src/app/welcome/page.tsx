import { redirect } from "next/navigation";
import { Phone } from "lucide-react";
import { getCurrentDbUser } from "@/lib/auth-guard";
import { listClients } from "@/lib/data/clients";
import { integrations } from "@/lib/env";
import { OnboardingWelcome } from "@/components/onboarding-welcome";

export const metadata = { title: "Get started" };

/** First-run setup for a self-serve business owner whose workspace has no business yet. */
export default async function WelcomePage() {
  const user = await getCurrentDbUser();
  const clients = await listClients(user.orgId);
  if (clients.length > 0) redirect("/portal");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-6">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Phone className="size-4" />
        </div>
        <span className="font-heading font-semibold tracking-tight">FrontDesk AI</span>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <OnboardingWelcome aiReady={integrations.anthropic()} />
      </main>
    </div>
  );
}
