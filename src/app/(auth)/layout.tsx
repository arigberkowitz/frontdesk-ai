import { Phone } from "lucide-react";
import { APP_NAME, APP_TAGLINE } from "@/config/app";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-muted/30 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Phone className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
      </div>
      {children}
    </main>
  );
}
