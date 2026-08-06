import { CalendarCheck, Clock, MessageSquare, UserCheck } from "lucide-react";

/** One line of the sample call. */
const TURNS: { who: "ai" | "caller"; text: string }[] = [
  { who: "ai", text: "Thanks for calling! This is Riley, your front desk. How can I help?" },
  { who: "caller", text: "Hi — do you have anything for a cleaning this week?" },
  { who: "ai", text: "We do! I have Thursday at 2:00 or Friday at 10:30. Which works better?" },
  { who: "caller", text: "Thursday at 2 is great." },
  // One question at a time, and permission asked before any text — because
  // that's what the real agent is required to do, and the consent question is
  // the opt-in workflow published on /sms-consent and registered with the
  // carriers. A sample call on the homepage in which the AI announces "I'll
  // text a confirmation" is the one place a reviewer can watch us describe
  // ourselves skipping our own consent step.
  { who: "ai", text: "Perfect — can I get your name?" },
  { who: "caller", text: "Jordan Lee." },
  { who: "ai", text: "Thanks Jordan. And the best number to reach you?" },
  { who: "caller", text: "415-555-0148." },
  {
    who: "ai",
    text: "Would you like me to text you the confirmation and a reminder? You can reply STOP any time.",
  },
  { who: "caller", text: "Yes please." },
  {
    who: "ai",
    text: "You're all set, Jordan — Thursday at 2:00 for a cleaning. That text is on its way.",
  },
];

const OUTCOMES = [
  { icon: CalendarCheck, label: "Appointment booked", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  { icon: MessageSquare, label: "Confirmation texted", className: "bg-muted text-muted-foreground" },
  { icon: UserCheck, label: "Contact saved", className: "bg-muted text-muted-foreground" },
];

/** Animated "what a call sounds like" sample — bubbles play in one by one (CSS only). */
export function DemoCall() {
  return (
    <div className="rounded-xl border bg-card p-4 text-left sm:p-5">
      <div className="mb-3 flex items-center gap-2 border-b pb-3 text-xs text-muted-foreground">
        <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
        Incoming call · sample
        <span className="ml-auto inline-flex items-center gap-1">
          <Clock className="size-3.5" /> 0:52
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {TURNS.map((t, i) => (
          <div
            key={i}
            className={
              t.who === "ai"
                ? "fd-fade-up max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm"
                : "fd-fade-up max-w-[85%] self-end rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-sm text-white"
            }
            style={{ animationDelay: `${0.15 + i * 0.4}s` }}
          >
            {t.text}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
        {OUTCOMES.map((o) => (
          <span
            key={o.label}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${o.className}`}
          >
            <o.icon className="size-3.5" />
            {o.label}
          </span>
        ))}
      </div>
    </div>
  );
}
