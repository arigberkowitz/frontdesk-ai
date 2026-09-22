"use client";

import { useActionState, useEffect, useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PanelHeader } from "@/components/panel-header";
import { saveChatWidgetSettingsAction } from "@/lib/actions/growth-settings";
import { initialActionState } from "@/lib/actions/types";

/**
 * The same receptionist, on the business's website — and in this portal.
 *
 * One switch. On: the bubble sits in the corner of every portal page (mounted
 * by the layout, so it survives navigation) and answers on the business's
 * website wherever the snippet is pasted. Off: gone from both. The card's
 * other job is making "put this on my site" a copy-paste.
 */
export function ChatWidgetCard({
  clientId,
  enabled,
  appUrl,
  isAdmin,
}: {
  clientId: string;
  enabled: boolean;
  appUrl: string;
  isAdmin: boolean;
}) {
  const [state, action, pending] = useActionState(saveChatWidgetSettingsAction, initialActionState);
  const [on, setOn] = useState(enabled);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!isAdmin) return null;

  const snippet = `<script src="${appUrl}/widget.js" data-client="${clientId}" async></script>`;

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={MessageCircle}
          title="Chat on your website"
          description="The same receptionist that answers your phone, as a chat bubble on your site. It knows the same services, hours and answers, and it books into the same calendar."
        />

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <label htmlFor="chat-enabled" className="text-sm font-medium">
                Turn the chat bubble on
              </label>
              <p className="text-xs text-muted-foreground">
                It appears in the corner of every page here, so you can talk to it yourself —
                and on your website once the snippet below is in place.
              </p>
            </div>
            <Switch
              id="chat-enabled"
              name="enabled"
              checked={on}
              onCheckedChange={setOn}
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Paste this just before <code>&lt;/body&gt;</code> on your site</p>
            <div className="flex items-start gap-2">
              <code className="block min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
                {snippet}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(snippet)
                    .then(() => toast.success("Copied."))
                    .catch(() => toast.error("Couldn't copy — select it and copy by hand."));
                }}
              >
                <Copy className="size-3.5" />
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Works on any site — Squarespace, Wix, WordPress, or hand-built. Add{" "}
              <code>data-accent=&quot;#yourcolor&quot;</code> to match your brand.
            </p>
          </div>

          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Visitors can ask questions, check openings, and book — the AI confirms details before it does.</li>
            <li>· It cannot transfer a chat to a person; it takes a message and you get the alert as usual.</li>
            <li>· Bookings and messages from chat show up on your Appointments and Leads pages like any other.</li>
          </ul>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
