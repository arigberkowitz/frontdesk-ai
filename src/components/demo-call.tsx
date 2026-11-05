"use client";

import { useState } from "react";
import {
  CalendarCheck,
  Clock,
  HelpCircle,
  Languages,
  MessageSquare,
  Moon,
  PhoneForwarded,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Turn {
  who: "ai" | "caller" | "system";
  text: string;
}

interface Scenario {
  key: string;
  tab: string;
  duration: string;
  turns: Turn[];
  /** Index of the AI line that lands the win — rendered in emerald. */
  payoffIndex: number | null;
  outcomes: { icon: LucideIcon; label: string; highlight?: boolean }[];
}

/**
 * Four calls instead of one. Each tab is a different reason the phone rings —
 * the booking, the quick question, the 2am emergency, the caller who switches
 * to Spanish — because "it answers calls" is an abstraction and four specific
 * conversations are not. Switching tabs replays the animation from the top:
 * the remount (key={scenario}) restarts every bubble's entrance for free.
 *
 * The booking script is a home-service job (our core buyers are trades) and asks permission before texting on purpose — that consent
 * question is the opt-in workflow published on /sms-consent and registered
 * with the carriers, and this card is where a reviewer can watch it happen.
 */
const SCENARIOS: Scenario[] = [
  {
    key: "booking",
    tab: "Book a job",
    duration: "0:58",
    turns: [
      { who: "ai", text: "Thanks for calling! This is Riley, the AI assistant. How can I help?" },
      { who: "caller", text: "Hi — my kitchen sink is leaking underneath. Can someone come out this week?" },
      { who: "ai", text: "We can. I have Thursday between 8 and 10, or Friday between 1 and 3. Which works better?" },
      { who: "caller", text: "Thursday morning." },
      { who: "ai", text: "Got it. What name and number should I put it under?" },
      { who: "caller", text: "Jordan Lee — 305-555-0148." },
      {
        who: "ai",
        text: "Would you like me to text you the confirmation, a reminder, and a quick follow-up about this visit? You can reply STOP any time.",
      },
      { who: "caller", text: "Yes please." },
      {
        who: "ai",
        text: "You're all set, Jordan — Thursday between 8 and 10 for the leak. That text is on its way.",
      },
    ],
    payoffIndex: 8,
    outcomes: [
      { icon: CalendarCheck, label: "Job booked", highlight: true },
      { icon: MessageSquare, label: "Confirmation texted" },
      { icon: UserCheck, label: "Contact saved" },
    ],
  },
  {
    key: "question",
    tab: "Quick question",
    duration: "0:31",
    turns: [
      { who: "ai", text: "Thanks for calling! This is Riley, the AI assistant. How can I help?" },
      { who: "caller", text: "How much do you charge to come out? And do you work Saturdays?" },
      {
        who: "ai",
        text: "The service call is $79, and it's waived if we do the job. We're out Monday to Friday, 8 to 5 — not Saturdays. Want me to find you a weekday slot?",
      },
      { who: "caller", text: "No, that's all I needed. Thanks!" },
      { who: "ai", text: "Anytime! Call back whenever you're ready." },
    ],
    payoffIndex: 2,
    outcomes: [
      { icon: HelpCircle, label: "Question answered", highlight: true },
      { icon: UserCheck, label: "No voicemail, no hold" },
    ],
  },
  {
    key: "emergency",
    tab: "2am emergency",
    duration: "0:19",
    turns: [
      { who: "ai", text: "Thanks for calling! This is Riley, the AI assistant. How can I help?" },
      { who: "caller", text: "My water heater burst — there's water everywhere!" },
      {
        who: "ai",
        text: "That sounds urgent — I'm connecting you to the owner's cell right now. One moment.",
      },
      { who: "system", text: "Transferred to the owner · 2:14 AM" },
    ],
    payoffIndex: null,
    outcomes: [
      { icon: PhoneForwarded, label: "Owner connected live", highlight: true },
      { icon: Moon, label: "After hours, still answered" },
    ],
  },
  {
    key: "spanish",
    tab: "En Español",
    duration: "0:44",
    turns: [
      { who: "ai", text: "Thanks for calling! This is Riley, the AI assistant. How can I help?" },
      { who: "caller", text: "Hola, ¿pueden venir mañana a revisar mi aire acondicionado?" },
      { who: "ai", text: "¡Claro que sí! Mañana tengo de 10 a 12 o de 3 a 5. ¿Cuál le conviene?" },
      { who: "caller", text: "De 10 a 12, por favor." },
      { who: "ai", text: "Perfecto — ¿a nombre de quién?" },
      { who: "caller", text: "María Torres." },
      { who: "ai", text: "Listo, María — mañana de 10 a 12. ¡Hasta mañana!" },
    ],
    payoffIndex: 6,
    outcomes: [
      { icon: CalendarCheck, label: "Appointment booked", highlight: true },
      { icon: Languages, label: "Switched to Spanish mid-call" },
    ],
  },
];

/** Interactive "what a call sounds like" sample. Pick the call; watch it play. */
export function DemoCall() {
  const [active, setActive] = useState(SCENARIOS[0].key);
  const scenario = SCENARIOS.find((s) => s.key === active) ?? SCENARIOS[0];

  return (
    // text-card-foreground is load-bearing: this card sits inside the hero's
    // dark stage, which sets its text white. Without the reset, the AI's half
    // of the conversation renders white-on-light-gray — invisible.
    <div className="rounded-xl border bg-card p-4 text-left text-card-foreground sm:p-5">
      <div className="mb-3 flex items-center gap-2 border-b pb-3 text-xs text-muted-foreground">
        <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
        Incoming call · sample
        <span className="ml-auto inline-flex items-center gap-1">
          <Clock className="size-3.5" /> {scenario.duration}
        </span>
      </div>

      {/* The interactive part: four reasons a phone rings. Switching replays
          the conversation from the first ring. */}
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Sample calls">
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={s.key === active}
            onClick={() => setActive(s.key)}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              s.key === active
                ? "bg-indigo-600 text-white"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {s.tab}
          </button>
        ))}
      </div>

      <div key={scenario.key} className="flex flex-col gap-2">
        {scenario.turns.map((t, i) => {
          if (t.who === "system") {
            return (
              <p
                key={i}
                className="fd-fade-up flex items-center justify-center gap-1.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                style={{ animationDelay: `${0.15 + i * 0.4}s` }}
              >
                <PhoneForwarded className="size-3.5" />
                {t.text}
              </p>
            );
          }
          return (
            <div key={i} className="contents">
              {/* Name the gray side once — a visitor should never have to
                  deduce which speaker is the product. */}
              {i === 0 ? (
                <span
                  className="fd-fade-up text-[11px] font-medium text-muted-foreground"
                  style={{ animationDelay: "0.15s" }}
                >
                  Riley · AI receptionist
                </span>
              ) : null}
              <div
                className={cn(
                  "fd-fade-up max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                  t.who === "ai"
                    ? i === scenario.payoffIndex
                      ? "self-start rounded-bl-sm border border-emerald-500/30 bg-emerald-500/10"
                      : "self-start rounded-bl-sm bg-muted"
                    : "self-end rounded-br-sm bg-indigo-600 text-white",
                )}
                style={{ animationDelay: `${0.15 + i * 0.4}s` }}
              >
                {t.text}
              </div>
            </div>
          );
        })}
      </div>

      <div key={`${scenario.key}-outcomes`} className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
        {scenario.outcomes.map((o, i) => (
          <span
            key={o.label}
            className={cn(
              "fd-fade-up inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              o.highlight
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
            style={{ animationDelay: `${0.3 + (scenario.turns.length + i) * 0.4}s` }}
          >
            <o.icon className="size-3.5" />
            {o.label}
          </span>
        ))}
      </div>
    </div>
  );
}
