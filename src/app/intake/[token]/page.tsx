import type { Metadata } from "next";
import { Phone } from "lucide-react";
import { verifyIntakeToken } from "@/lib/intake-token";
import { getClientByIdUnsafe } from "@/lib/data/clients";
import { IntakeForm } from "@/components/intake/intake-form";
import { APP_NAME } from "@/config/app";

export const metadata: Metadata = { title: "Set up your AI receptionist" };

/** Public, token-authorized intake — a link the operator sends a new client. */
export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const clientId = verifyIntakeToken(token);
  const client = clientId ? await getClientByIdUnsafe(clientId) : null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-6">
        <div
          className="flex size-8 items-center justify-center rounded-lg text-white"
          style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
        >
          <Phone className="size-4" />
        </div>
        <span className="font-heading font-semibold tracking-tight">{APP_NAME}</span>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        {client ? (
          <IntakeForm
            token={token}
            defaultName={client.name === "Your business" ? "" : client.name}
            defaultWebsite={client.websiteUrl ?? ""}
          />
        ) : (
          <div className="mx-auto max-w-md space-y-2 text-center">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Link expired</h1>
            <p className="text-muted-foreground">
              This setup link is invalid or has expired. Please ask whoever sent it for a fresh one.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
