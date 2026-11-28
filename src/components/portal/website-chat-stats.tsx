import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getWebChatStats } from "@/lib/data/chat-limits";
import { planAccessFor } from "@/lib/plan-access";

/**
 * Overview card: what the website chat did in the last 30 days. Real counts
 * from the chat's own turn log (distinct conversations; leads and bookings
 * only when the tool said it succeeded). Shown only when the chat is on and
 * the plan includes it; hidden when the numbers can't be read.
 */
export async function WebsiteChatStatsSection({
  client,
}: {
  client: { id: string; status: string; chatWidgetEnabled: boolean; setupFlags?: { comped?: boolean } | null };
}) {
  if (!client.chatWidgetEnabled) return null;
  const access = await planAccessFor(client).catch(() => null);
  if (!access?.has("website_chat")) return null;
  const stats = await getWebChatStats(client.id);
  if (!stats) return null;
  const items: Array<[string, number]> = [
    ["Chats", stats.chats],
    ["Leads from chat", stats.leads],
    ["Bookings from chat", stats.bookings],
  ];
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
            <MessageCircle className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Website chat · last {stats.days} days</p>
            <Link
              href="/portal/settings/follow-ups#website-chat"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Chat settings
            </Link>
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-6 text-center sm:text-right">
          {items.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums">{value.toLocaleString("en-US")}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
