"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { CopilotChat } from "@/components/portal/copilot-chat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Owner copilot, available on every portal page: a bottom-right chat bubble
 * that opens a "Frontdesk Assistant" panel. CopilotChat stays mounted while
 * the panel is closed so the conversation survives the session.
 *
 * On phones the bubble and panel sit above the PortalTabBar and honor safe-
 * area insets. `preview` leaves room for the operator preview banner so the
 * panel never covers "Exit preview".
 */
export function CopilotBubble({
  preview = false,
  defaultOpen = false,
}: {
  preview?: boolean;
  /** Test/screenshot hook. Production always starts closed. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = useId();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(defaultOpen);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      panelRef.current?.focus();
      return;
    }
    if (wasOpen.current) buttonRef.current?.focus();
  }, [open]);

  return (
    <div className="contents">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Open Frontdesk Assistant"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
        className={cn(
          // Above the phone tab bar (dock is ~3.5rem + 0.75rem/safe-area inset).
          // Desktop has no dock, so the bubble sits in the corner.
          "fixed z-40 flex size-12 items-center justify-center rounded-full",
          "right-[max(1rem,env(safe-area-inset-right))]",
          "bottom-[calc(5.75rem+max(0.75rem,env(safe-area-inset-bottom)))]",
          "bg-primary bg-(image:--primary-image) text-primary-foreground",
          "shadow-(--primary-shadow) outline-none transition-all duration-200",
          "hover:shadow-(--primary-shadow-hover) hover:not-active:translate-y-(--lift)",
          "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:shadow-(--focus-glow)",
          "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          "md:size-14 md:right-[max(1.5rem,env(safe-area-inset-right))]",
          "md:bottom-[max(1.5rem,env(safe-area-inset-bottom))]",
          open && "hidden",
        )}
      >
        <MessageCircle className="size-5 md:size-6" aria-hidden />
      </button>

      <div
        id={panelId}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        hidden={!open}
        className={cn(
          "fixed z-40 flex flex-col overflow-hidden rounded-2xl border bg-background shadow-xl shadow-(--overlay-shadow) outline-none",
          // Phones: almost full width, above the tab bar, below the header
          // (and the operator preview banner when that's showing).
          "inset-x-3",
          "bottom-[calc(5.75rem+max(0.75rem,env(safe-area-inset-bottom)))]",
          preview
            ? "top-[calc(7.25rem+env(safe-area-inset-top))]"
            : "top-[calc(4.5rem+env(safe-area-inset-top))]",
          // Desktop: a compact card in the bottom-right, well clear of the header.
          "md:inset-auto md:right-[max(1.5rem,env(safe-area-inset-right))]",
          "md:bottom-[max(1.5rem,env(safe-area-inset-bottom))]",
          "md:top-auto md:max-h-[min(36rem,calc(100dvh-8rem))] md:w-[24rem]",
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
          <MessageCircle className="size-4 shrink-0 text-brand" aria-hidden />
          <h2 id={titleId} className="min-w-0 flex-1 font-heading text-sm font-semibold leading-tight">
            Frontdesk Assistant
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close Frontdesk Assistant"
            onClick={() => setOpen(false)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
        <CopilotChat variant="plain" />
      </div>
    </div>
  );
}
