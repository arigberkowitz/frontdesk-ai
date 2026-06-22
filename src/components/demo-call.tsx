import { CalendarCheck, Clock, MessageSquare, UserCheck } from "lucide-react";

/** One line of the sample call. */
const TURNS: { who: "ai" | "caller"; text: string }[] = [
  { who: "ai", text: "Thanks for calling! This is Riley, your front desk. How can I help?" },
  { who: "caller", text: "Hi — do you have anything for a cleaning this week?" },
  { who: "ai", text: "We do! I have Thursday at 2:00 or Friday at 10:30. Which works better?" },
  { who: "caller", text: "Thursday at 2 is great." },
  { who: "ai", text: "Perfect — can I grab your name and a good callback number?" },
  { who: "caller", text: "Jordan Lee, 415-555-0148." },
  {
    who: "ai",
    text: "You're all set, Jordan — Thursday at 2:00 for a cleaning. I'll text a confirmation. Anything else?",
  },
];

const OUTCOMES = [
  { icon: CalendarCheck, label: "Appointment booked", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
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
          <Clock className="size-3.5" /> 0:38
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
