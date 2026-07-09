import Link from "next/link";
import { Phone } from "lucide-react";
import { APP_NAME } from "@/config/app";

/** Shared shell for /terms and /privacy — quiet, readable, on-brand. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2.5 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="flex size-8 items-center justify-center rounded-lg text-white"
              style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
            >
              <Phone className="size-4" />
            </span>
            <span className="font-heading text-lg font-semibold tracking-tight">{APP_NAME}</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>
            © {new Date().getFullYear()} {APP_NAME}
          </span>
          <span className="flex gap-4">
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
