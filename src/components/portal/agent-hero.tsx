import { PhoneCall, Rocket, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Top of "Your AI": the receptionist as a presence — a breathing voice orb,
 * a listening waveform, its name, its line and one button to hear it.
 * Presentational only: the page passes in what it already loaded, and the
 * button just jumps to the existing test-call controls below.
 */
export function AgentHero({
  agentName,
  businessName,
  phoneNumber,
  state,
  cta,
}: {
  agentName: string;
  businessName: string;
  phoneNumber: string | null;
  /** ready = provisioned; paused = business paused; setup = not activated yet. */
  state: "ready" | "paused" | "setup";
  /** Which in-page control the button jumps to, when this viewer has one. */
  cta: "test" | "activate" | null;
}) {
  const alive = state === "ready";
  const statusLabel =
    state === "ready"
      ? phoneNumber
        ? "Ready and answering"
        : "Ready to test in your browser"
      : state === "paused"
        ? "Paused — not answering calls"
        : "Not switched on yet";

  return (
    <section aria-labelledby="agent-title" className="fd-panel fd-fade-up p-5 sm:p-7">
      <div aria-hidden className="fd-hero-mesh" />
      <div aria-hidden className="fd-hero-grid" />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
        <div className="flex items-center gap-5">
          <div className="fd-orb" data-state={alive ? "live" : "idle"} aria-hidden>
            <span className="fd-orb-swirl" />
          </div>
          <div className="fd-wave sm:hidden" data-state={alive ? "live" : "idle"} aria-hidden>
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="fd-eyebrow">Your AI receptionist</p>
          <h2
            id="agent-title"
            className="mt-1.5 font-heading text-[1.75rem] leading-tight font-semibold tracking-tight sm:text-3xl"
          >
            <span className="fd-gradient-text">{agentName}</span>
            <span className="text-foreground"> at {businessName}</span>
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              role="status"
              className="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-sm"
            >
              <span
                aria-hidden
                className={cn(
                  alive ? "fd-live-dot" : "size-2 shrink-0 rounded-full",
                  state === "paused" && "bg-amber-500",
                  state === "setup" && "bg-brand",
                )}
              />
              <span className="font-medium">{statusLabel}</span>
            </span>
            {phoneNumber ? (
              <span className="text-sm text-muted-foreground tabular-nums">
                Line: <span className="font-medium text-foreground">{formatPhone(phoneNumber)}</span>
              </span>
            ) : null}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden />
            Always says it&apos;s an AI, handles emergencies first, and follows your rules below.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <div className="fd-wave hidden sm:inline-flex" data-state={alive ? "live" : "idle"} aria-hidden>
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} />
            ))}
          </div>
          {cta === "activate" ? (
            <Button size="lg" render={<a href="#activate" />} nativeButton={false} className="px-4">
              <Rocket className="size-4" />
              Switch it on
            </Button>
          ) : cta === "test" ? (
            <Button size="lg" render={<a href="#test-call" />} nativeButton={false} className="px-4">
              <PhoneCall className="size-4" />
              Make a test call
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
