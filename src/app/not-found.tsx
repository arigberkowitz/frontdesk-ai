import Link from "next/link";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Styled 404 so a stray URL never lands on Next's bare default page. */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div
        className="flex size-12 items-center justify-center rounded-2xl text-white"
        style={{ background: "linear-gradient(135deg,#6366f1,#10b981)" }}
      >
        <Phone className="size-6" />
      </div>
      <div className="space-y-1.5">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Page not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          That link doesn&apos;t exist or has moved. Let&apos;s get you back on track.
        </p>
      </div>
      <Button render={<Link href="/" />} nativeButton={false}>
        Back to home
      </Button>
    </div>
  );
}
