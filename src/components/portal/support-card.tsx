import { Mail, MessageSquare, Phone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPhone } from "@/lib/format";
import { SUPPORT_EMAIL } from "@/config/contact";

/**
 * A person to reach, at the bottom of Settings.
 *
 * This product answers other people's phones. When it misbehaves, the owner's
 * phone line is on fire and "open a ticket" is an insult — what they need is a
 * human they can text right now. At this size the founder IS support, and
 * saying so plainly is a selling point no bigger competitor can copy.
 */
const SUPPORT = {
  name: "Ari",
  phone: "+14157475690",
  email: SUPPORT_EMAIL,
};

export function SupportCard() {
  const pretty = formatPhone(SUPPORT.phone);
  return (
    <Card>
      <CardHeader className="gap-1">
        <CardTitle>Need a hand?</CardTitle>
        <CardDescription>
          You reach {SUPPORT.name} — the person who runs FrontDesk AI — not a ticket queue. If your
          line is misbehaving, text or call and it gets looked at right away.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <a
          href={`sms:${SUPPORT.phone}`}
          className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
        >
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
          Text {pretty}
        </a>
        <a
          href={`tel:${SUPPORT.phone}`}
          className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
        >
          <Phone className="size-4 shrink-0 text-muted-foreground" />
          Call {pretty}
        </a>
        <a
          href={`mailto:${SUPPORT.email}`}
          className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
        >
          <Mail className="size-4 shrink-0 text-muted-foreground" />
          {SUPPORT.email}
        </a>
      </CardContent>
    </Card>
  );
}
