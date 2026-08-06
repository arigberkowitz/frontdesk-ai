import { redirect } from "next/navigation";
import { Phone } from "lucide-react";
import { getCurrentDbUser } from "@/lib/auth-guard";
import { listClients } from "@/lib/data/clients";
import { integrations } from "@/lib/env";
import { OnboardingWelcome } from "@/components/onboarding-welcome";

export const metadata = { title: "Get started" };

/** First-run setup for a self-serve business owner whose workspace has no business yet. */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  const user = await getCurrentDbUser();
  // Already attached to a business → nothing to set up here.
  if (user.clientId) redirect("/portal");
  if (user.role === "operator") {
    // Legacy self-serve operator workspaces: done once a business exists.
    const clients = await listClients(user.orgId);
    if (clients.length > 0) redirect("/portal");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-6">
        <div
          className="flex size-8 items-center justify-center rounded-lg text-white"
          style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
        >
          <Phone className="size-4" />
        </div>
        <span className="font-heading font-semibold tracking-tight">FrontDesk AI</span>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <OnboardingWelcome aiReady={integrations.anthropic()} plan={plan ?? null} />
      </main>
    </div>
  );
}
