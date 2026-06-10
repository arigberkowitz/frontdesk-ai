import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Clock, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Demo" };

const SAMPLE: { who: "caller" | "ai"; text: string }[] = [
  { who: "ai", text: "Thanks for calling! This is your AI assistant. How can I help?" },
  { who: "caller", text: "Hi — do you have anything available this week?" },
  { who: "ai", text: "We do! I have Thursday at 2:00 or Friday at 10:30. Which works better?" },
  { who: "caller", text: "Thursday at 2 is great." },
  { who: "ai", text: "Perfect. Can I get your name and a good callback number?" },
  { who: "caller", text: "Jordan Lee, 415-555-0148." },
  { who: "ai", text: "You're all set, Jordan — Thursday at 2:00. We'll text a confirmation. Anything else?" },
];

const TALKING_POINTS = [
  { icon: Clock, title: "Answers 24/7", body: "Every call picked up on the first ring — nights, weekends, lunch rushes." },
  { icon: CalendarCheck, title: "Books in the moment", body: "Checks your hours and schedules the appointment live, on the call." },
  { icon: MessageSquare, title: "Never loses a lead", body: "Captures name, number, and reason — and alerts you instantly." },
];

export default function PortalDemoPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="See it in action"
        description="Here's what your AI receptionist does on every call."
      >
        <Button variant="outline" render={<Link href="/portal/guidelines" />} nativeButton={false}>
          Test your receptionist
          <ArrowRight className="size-4" />
        </Button>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What it does</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {TALKING_POINTS.map((p) => (
              <div key={p.title} className="rounded-lg border p-3">
                <p.icon className="size-4 text-primary" />
                <p className="mt-2 text-sm font-medium">{p.title}</p>
                <p className="text-xs text-muted-foreground">{p.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What a call sounds like</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {SAMPLE.map((line, i) => (
              <div key={i} className={line.who === "ai" ? "flex justify-start" : "flex justify-end"}>
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
              Illustrative — your receptionist uses your own services, hours, and FAQs.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
