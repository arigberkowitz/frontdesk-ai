"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/panel-header";
import { copilotAction } from "@/lib/actions/copilot";
import { cn } from "@/lib/utils";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "How many after-hours calls did I get last month?",
  "Which leads are still waiting on me?",
  "Add a FAQ: we have free parking behind the building.",
];

/** Agent #6 — chat over the business's own data (calls, leads, bookings, FAQ).
 *  `card` is the original standalone panel. `plain` is the body inside the
 *  portal-wide Frontdesk Assistant bubble (no second title or card chrome). */
export function CopilotChat({ variant = "card" }: { variant?: "card" | "plain" }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = (text: string) => {
    const question = text.trim();
    if (!question || pending) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("question", question);
      fd.set("history", JSON.stringify(history.slice(-12)));
      const res = await copilotAction({ reply: null }, fd);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: res.reply ?? res.error ?? "Something went wrong." },
      ]);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
      );
    });
  };

  const thread =
    messages.length === 0 ? (
      <div className={cn("flex flex-wrap gap-2", variant === "card" ? "mt-4" : "px-4")}>
        {variant === "plain" ? (
          <p className="mb-1 w-full text-sm text-muted-foreground">
            It knows your calls, leads, and bookings — and can teach your AI new answers.
          </p>
        ) : null}
        {STARTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground outline-none max-sm:py-2.5 max-sm:text-left transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {s}
          </button>
        ))}
      </div>
    ) : (
      <div
        ref={scrollRef}
        className={cn(
          "space-y-3 overflow-y-auto pr-1",
          variant === "card" ? "mt-4 max-h-80" : "min-h-0 flex-1 px-4",
        )}
      >
        {messages.map((m, i) => (
          <div
            key={`${i}-${m.role}`}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] break-words whitespace-pre-wrap rounded-xl px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
            >
              {m.content}
            </div>
          </div>
        ))}
        {pending ? (
          <div className="flex justify-start">
            <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
              Checking your data…
            </div>
          </div>
        ) : null}
      </div>
    );

  const form = (
    <form
      className={cn("flex items-center gap-2", variant === "card" ? "mt-4" : "mt-auto border-t p-4")}
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
    >
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        aria-label="Ask your front desk"
        placeholder="Ask about your calls, leads, bookings…"
        className="flex-1"
        disabled={pending}
      />
      <Button type="submit" size="icon" disabled={pending || !input.trim()} aria-label="Send">
        <ArrowUp className="size-4" />
      </Button>
    </form>
  );

  if (variant === "plain") {
    return (
      <div className="flex min-h-0 flex-1 flex-col py-4">
        {thread}
        {form}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={Sparkles}
          title="Ask your front desk"
          description="It knows your calls, leads, and bookings — and can teach your AI new answers."
        />
        {thread}
        {form}
      </CardContent>
    </Card>
  );
}
