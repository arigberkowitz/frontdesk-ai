"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

/** Agent #6 — chat over the business's own data (calls, leads, bookings, FAQ). */
export function CopilotChat() {
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

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
            <Sparkles className="size-4" />
          </span>
          <div>
            <p className="font-heading text-xl font-semibold tracking-tight">Ask your front desk</p>
            <p className="text-sm text-muted-foreground">
              It knows your calls, leads, and bookings — and can teach your AI new answers.
            </p>
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <div ref={scrollRef} className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
            {messages.map((m, i) => (
              <div
                key={`${i}-${m.role}`}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm",
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
        )}

        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your calls, leads, bookings…"
            className="h-10 flex-1 rounded-lg border bg-background px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
            disabled={pending}
          />
          <Button type="submit" size="icon" disabled={pending || !input.trim()} aria-label="Send">
            <ArrowUp className="size-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
