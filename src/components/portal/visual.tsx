import type { LucideIcon } from "lucide-react";
import { Frown, Meh, Smile, User } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small presentational pieces shared by the portal lists (calls, messages,
 * leads, appointments). Display only: no data loading, no actions.
 */

/** Six soft gradient tones for avatars and service chips (all AA on white text). */
export const TONES = 6;

/** Stable 0..TONES-1 bucket for any string, so a person keeps their color everywhere. */
export function toneFor(seed: string | null | undefined): number {
  const s = (seed ?? "").replace(/\s+/g, "").toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % TONES;
}

/** "Maria Gomez" → "MG", "Dr. Lee" → "DL", "priya" → "P". Null when there's no usable name. */
export function initialsFor(name: string | null | undefined): string | null {
  const words = (name ?? "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  if (!words.length) return null;
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

/** Initials in a softly lit gradient disc. Falls back to a person glyph. */
export function InitialsAvatar({
  name,
  seed,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  /** What picks the color — usually the phone number, so it survives a name change. */
  seed?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const initials = initialsFor(name);
  return (
    <span
      aria-hidden
      data-tone={toneFor(seed ?? name)}
      data-size={size}
      className={cn("fd-avatar", className)}
    >
      {initials ?? <User className="size-[45%]" />}
    </span>
  );
}

export type ChipTone = "violet" | "emerald" | "sky" | "amber" | "rose" | "slate" | "cyan";

/** Rounded status chip with an optional leading dot or icon. */
export function Chip({
  tone = "slate",
  icon: Icon,
  dot = false,
  className,
  title,
  children,
}: {
  tone?: ChipTone;
  icon?: LucideIcon;
  dot?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span data-tone={tone} className={cn("fd-chip", className)} title={title}>
      {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
      {dot && !Icon ? <span className="fd-chip-dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

export const SENTIMENT_CHIP: Record<string, { label: string; tone: ChipTone; icon: LucideIcon }> = {
  positive: { label: "Happy", tone: "emerald", icon: Smile },
  neutral: { label: "Neutral", tone: "slate", icon: Meh },
  negative: { label: "Frustrated", tone: "rose", icon: Frown },
};

/** Service chips cycle through a palette keyed by the service name. */
export const SERVICE_TONES: ChipTone[] = ["violet", "cyan", "emerald", "amber", "sky", "rose"];
export function serviceTone(name: string | null | undefined): ChipTone {
  return name ? SERVICE_TONES[toneFor(name)] : "slate";
}

/** Chip tones per call outcome, in the same color families as the outcomes donut. */
export const OUTCOME_TONE: Record<string, ChipTone> = {
  booked: "emerald",
  lead: "violet",
  faq_answered: "sky",
  escalated: "amber",
  spam: "slate",
  missed: "rose",
  other: "slate",
};
