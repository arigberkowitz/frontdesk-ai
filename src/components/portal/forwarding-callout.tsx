import { PhoneForwarded } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { forwardingVariants, type CodeVariant, type ForwardMode } from "@/lib/forwarding-codes";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Tap-to-dial. On a phone this opens the dialer pre-filled, so forwarding is
 * one tap instead of a code retyped from memory. `*` and `#` must be
 * percent-encoded or some dialers silently drop the rest of the string.
 */
export const dialHref = (seq: string) => `tel:${seq.replace(/\*/g, "%2A").replace(/#/g, "%23")}`;

function DialLink({ seq, label, big }: { seq: string; label: string; big?: boolean }) {
  return (
    <a
      href={dialHref(seq)}
      aria-label={label}
      className={cn(
        buttonVariants({ variant: big ? "default" : "outline", size: "lg" }),
        "tabular-nums",
        big ? "h-11 px-4 text-base" : "h-10 px-3 text-sm",
      )}
    >
      <PhoneForwarded className={big ? "size-4" : "size-3.5"} />
      Dial
    </a>
  );
}

function CodeRow({
  tone,
  label,
  items,
  big,
}: {
  tone: "on" | "off";
  label: string;
  items: CodeVariant["on"];
  big?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          tone === "on" ? "text-emerald-700" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.seq} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <code
                data-testid="fwd-code"
                className={cn(
                  "block break-all rounded-md bg-background px-2.5 py-1.5 font-semibold tabular-nums text-foreground ring-1 ring-border",
                  big ? "text-lg sm:text-xl" : "text-base",
                )}
              >
                {it.show}
              </code>
              {items.length > 1 ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">{it.label}</span>
              ) : null}
            </div>
            <DialLink seq={it.seq} label={`Dial ${it.show}`} big={big} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The first thing on the Phone & AI card: exactly what to dial to turn
 * forwarding on and off, for the plan's mode, with a variant per carrier type.
 * Big on purpose. A business that doesn't know these two codes can't use the
 * product.
 */
export function ForwardingCallout({ mode, phoneNumber }: { mode: ForwardMode; phoneNumber: string }) {
  const variants = forwardingVariants(mode, phoneNumber);
  const pretty = formatPhone(phoneNumber);
  const missed = mode === "missed_only";

  return (
    <section
      aria-labelledby="fwd-callout-title"
      data-testid="forwarding-callout"
      className="space-y-4 rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 sm:p-5"
    >
      <div>
        <h3 id="fwd-callout-title" className="font-heading text-lg font-semibold">
          {missed ? "Forward only the calls you miss" : "Forward every call to your AI"}
        </h3>
        <p className="text-sm text-muted-foreground">
          Find your phone type and dial its codes{" "}
          <strong className="text-foreground">from your business phone</strong>, the line customers
          already call. Then hang up. Your AI&apos;s number is{" "}
          <span className="font-medium tabular-nums text-foreground">{pretty}</span>.
        </p>
      </div>

      {/* Every phone type at the same size: nobody should have to guess which
          code is "theirs", and AT&T / T-Mobile owners are a big share. */}
      <div
        className={cn("grid gap-3", variants.length === 3 ? "lg:grid-cols-3" : "sm:grid-cols-2")}
        data-testid="forwarding-variants"
      >
        {variants.map((v) => (
          <div
            key={v.id}
            data-variant={v.id}
            className="space-y-3 rounded-xl bg-background p-4 ring-1 ring-border"
          >
            <p className="text-sm font-semibold">{v.who}</p>
            <CodeRow tone="on" label="Turn on" items={v.on} big />
            <CodeRow tone="off" label="Turn off" items={v.off} big />
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        On a phone, tap Dial and it fills the dialer for you. On a computer, key the code in on your
        business phone: dialing it from any other line won&apos;t do anything.
      </p>
    </section>
  );
}

/**
 * The same codes, smaller, for the setup checklist. Every phone type is shown
 * (Verizon/office, AT&T, T-Mobile) with tap-to-dial, so the checklist never
 * shows only the codes that suit one carrier.
 */
export function ForwardingCodesCompact({ variants }: { variants: CodeVariant[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="checklist-forwarding-codes">
      {variants.map((v) => (
        <div key={v.id} className="space-y-1.5 rounded-lg bg-muted/40 p-2.5 text-xs ring-1 ring-border">
          <p className="font-semibold">{v.who}</p>
          {[
            { tone: "on" as const, label: "On", items: v.on },
            { tone: "off" as const, label: "Off", items: v.off },
          ].map((row) => (
            <div key={row.tone} className="space-y-1">
              {row.items.map((it) => (
                <div key={it.seq} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="mr-1.5 font-medium text-muted-foreground">{row.label}</span>
                    <code className="break-all font-semibold tabular-nums text-foreground">{it.show}</code>
                  </span>
                  <a
                    href={dialHref(it.seq)}
                    aria-label={`Dial ${it.show}`}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}
                  >
                    Dial
                  </a>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
