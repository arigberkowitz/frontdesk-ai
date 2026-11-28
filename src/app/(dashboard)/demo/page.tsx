import type { Metadata } from "next";
import { leadAlertPhrase } from "@/lib/texting-copy";
import { CalendarCheck, Clock, MessageSquare, Phone, Sparkles } from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPhone } from "@/lib/format";

export const metadata: Metadata = { title: "Demo" };

const SAMPLE: { who: "caller" | "ai"; text: string }[] = [
  { who: "ai", text: "Thanks for calling Ace Plumbing! This is Riley, the AI assistant. How can I help?" },
  { who: "caller", text: "Hi — my kitchen sink is leaking underneath. Can someone come out this week?" },
  { who: "ai", text: "We can. I have Thursday between 8 and 10, or Friday between 1 and 3. Which works better?" },
  { who: "caller", text: "Thursday morning." },
  { who: "ai", text: "Got it. What name and number should I put it under?" },
  { who: "caller", text: "Jordan Lee, 415-555-0148." },
  { who: "ai", text: "Would you like me to text you the confirmation, a reminder, and a quick follow-up about this visit? You can reply STOP any time." },
  { who: "caller", text: "Yes please." },
  {
    who: "ai",
    text: env.SMS_ENABLED
      ? "You're all set, Jordan — Thursday between 8 and 10 for the leak. That text is on its way."
      : "You're all set, Jordan — Thursday between 8 and 10 for the leak. See you then.",
  },
];

const TALKING_POINTS = [
  { icon: Clock, title: "Answers 24/7", body: "Every call picked up on the first ring — nights, weekends, lunch rushes." },
  { icon: CalendarCheck, title: "Books in the moment", body: "Checks the calendar and schedules the appointment live, on the call." },
  { icon: MessageSquare, title: "Never loses a lead", body: `Captures name, number, and reason — and ${leadAlertPhrase(env.SMS_ENABLED)} instantly.` },
];

export default async function DemoPage() {
  await requireOperator();
  const number = env.DEMO_PHONE_NUMBER;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demo"
        description="A live agent you can show prospects — let them hear it answer and book."
      >
        <Badge variant="secondary">
          <Sparkles className="size-3" />
          Sales tool
        </Badge>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Hear it live</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Call the demo number and talk to the AI receptionist exactly as a customer would.
            </p>
            {number ? (
              <div className="rounded-xl border bg-muted/40 p-6 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Call now</p>
                <p className="mt-1 font-mono text-3xl font-semibold tracking-tight tabular-nums">
                  {formatPhone(number)}
                </p>
                <Button
                  className="mt-4"
                  render={<a href={`tel:${number.replace(/[^\d+]/g, "")}`} />}
                  nativeButton={false}
                >
                  <Phone className="size-4" />
                  Call the demo line
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No demo number yet</p>
                <p className="mt-1">
                  Provision a demo client, then set <code>DEMO_PHONE_NUMBER</code> in your
                  environment to show a live call here.
                </p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              {TALKING_POINTS.map((p) => (
                <div key={p.title} className="rounded-lg border p-3">
                  <p.icon className="size-4 text-primary" />
                  <p className="mt-2 text-sm font-medium">{p.title}</p>
                  <p className="text-xs text-muted-foreground">{p.body}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What a call sounds like</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {SAMPLE.map((line, i) => (
              <div
                key={i}
                className={line.who === "ai" ? "flex justify-start" : "flex justify-end"}
              >
                <div
                  className={
                    line.who === "ai"
                      ? "max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm"
                      : "max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                  }
                >
                  {line.text}
                </div>
              </div>
            ))}
            <p className="pt-2 text-center text-xs text-muted-foreground">
              Illustrative — your demo agent uses a real client’s services and hours.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
