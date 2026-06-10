import Link from "next/link";
import { CalendarCheck, CalendarPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Per-business Google Calendar connect / disconnect (links to the OAuth routes). */
export function CalendarConnect({
  clientId,
  provider,
  account,
}: {
  clientId: string;
  provider: string | null;
  account: string | null;
}) {
  const connected = provider === "google";
  return (
    <Card className={connected ? "border-emerald-500/30 bg-emerald-500/5" : undefined}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <CalendarCheck className="size-4" />
          </div>
          <div className="text-sm">
            {connected ? (
              <>
                <p className="font-medium">Google Calendar connected</p>
                <p className="text-muted-foreground">
                  {account ? `New bookings sync to ${account}` : "New bookings sync to your calendar"}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Sync to your Google Calendar</p>
                <p className="text-muted-foreground">
                  Connect once and every booking lands in your own calendar automatically.
                </p>
              </>
            )}
          </div>
        </div>
        {connected ? (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href={`/api/calendar/google/disconnect?client=${clientId}`} prefetch={false} />
            }
          >
            Disconnect
          </Button>
        ) : (
          <Button
            size="sm"
            nativeButton={false}
            render={
              <Link href={`/api/calendar/google/connect?client=${clientId}`} prefetch={false} />
            }
          >
            <CalendarPlus className="size-4" />
            Connect Google Calendar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
