import { MessageSquareWarning } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * "Your customers aren't getting their texts."
 *
 * Every other failure in this product is loud: a call that doesn't connect, a
 * booking that doesn't save. A text that fails is silent — the row says
 * "failed", the owner never opens that row, and the first they hear of it is a
 * customer saying nobody told them anything. Production ran for days with
 * rejected Twilio credentials and every confirmation, reminder and follow-up
 * failed without a single thing on screen changing.
 *
 * So it goes at the top, it says how many, and it says whose problem it is —
 * because "reconnect your texting" is useless advice when the credentials are
 * ours, not theirs.
 */
export function TextingBrokenBanner({
  count,
  ourFault,
}: {
  count: number;
  /** True when the failure is in our own configuration, not anything they set. */
  ourFault: boolean;
}) {
  if (count < 1) return null;
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex items-start gap-3 py-4">
        <MessageSquareWarning className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {count === 1
              ? "A text to a customer didn't go through"
              : `${count} texts to customers didn't go through`}{" "}
            in the last 7 days
          </p>
          <p className="text-xs text-muted-foreground">
            {ourFault
              ? "This is a problem on our side, not yours — texting is rejecting our credentials. We can see it and we're on it. In the meantime your AI is still answering and booking normally; the confirmations just aren't being delivered, so those customers haven't heard anything."
              : "These customers agreed to a text and never received one. Open the call or appointment to see why, and reach them another way if it still matters."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
