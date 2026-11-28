import { Mail } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPPORT_EMAIL, supportMailto } from "@/config/contact";

/**
 * A person to reach, at the bottom of Settings.
 *
 * This product answers other people's phones. When it misbehaves, the owner's
 * line is on fire and "open a ticket" is an insult — they need a person. At
 * this size the founder IS support, and saying so plainly is a selling point.
 *
 * Email only: a personal phone number here would go to every customer and
 * can't be taken back once it's out.
 */
export function SupportCard() {
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>Need a hand?</CardTitle>
        <CardDescription>
          You reach Ari, the person who runs FrontDesk AI, not a ticket queue. If your line is
          misbehaving, email and it gets looked at right away.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <a
          href={supportMailto("Help with my FrontDesk line")}
          className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
        >
          <Mail className="size-4 shrink-0 text-muted-foreground" />
          {SUPPORT_EMAIL}
        </a>
      </CardContent>
    </Card>
  );
}
