"use client";

import { useState } from "react";
import Link from "next/link";
import { Video } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { disconnectZoomAction } from "@/lib/actions/calendar";

/**
 * "Connect Zoom": lets services set to Zoom send a real Zoom link. Shown only
 * when the Zoom app is configured (ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET), so
 * there's never a button that leads to a dead page. Zoom is separate from the
 * calendar: a business keeps Google Calendar and adds Zoom on top.
 */
export function ZoomConnectCard({
  clientId,
  account,
  connected,
  canEdit,
}: {
  clientId: string;
  account: string | null;
  connected: boolean;
  canEdit: boolean;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Card className={connected ? "border-emerald-500/30 bg-emerald-500/5" : undefined}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
            <Video className="size-4" />
          </div>
          <div className="text-sm">
            <p className="font-medium">{connected ? "Zoom connected" : "Connect Zoom"}</p>
            <p className="text-muted-foreground">
              {connected
                ? `Video appointments set to Zoom get a meeting on ${account ?? "your Zoom account"}.`
                : "So video appointments can send a Zoom link. Google Meet works without this."}
            </p>
          </div>
        </div>
        {!canEdit ? null : connected ? (
          armed ? (
            <form action={disconnectZoomAction} className="flex items-center gap-2">
              <input type="hidden" name="clientId" value={clientId} />
              <span className="text-xs text-muted-foreground">Zoom services will book without a link.</span>
              <Button type="submit" variant="destructive" size="sm">
                Yes, disconnect
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
                Keep it
              </Button>
            </form>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setArmed(true)}>
              Disconnect
            </Button>
          )
        ) : (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/api/calendar/zoom/connect?client=${clientId}`} prefetch={false} />}
          >
            Connect Zoom
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
