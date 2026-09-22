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
 * The same receptionist, on the business's website.
 *
 * The card's job is to make "put this on my site" a copy-paste, and to let
 * the owner talk to their own receptionist right here before a customer
 * does. The preview mounts the real widget script pointing at this business,
 * so what they see is exactly what a visitor gets — not a mock.
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
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  // Mount the real widget on demand, and take it down with the toggle.
  useEffect(() => {
    if (!previewing) return;
    const s = document.createElement("script");
    s.src = `${appUrl}/widget.js`;
    s.async = true;
    s.setAttribute("data-client", clientId);
    document.body.appendChild(s);
    return () => {
      s.remove();
      document.getElementById("frontdesk-chat")?.remove();
    };
  }, [previewing, appUrl, clientId]);

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
            <label htmlFor="chat-enabled" className="text-sm font-medium">
              Answer chats from my website
            </label>
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

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!enabled}
              onClick={() => setPreviewing((v) => !v)}
              title={enabled ? undefined : "Save it on first, then try it here"}
            >
              {previewing ? "Hide the preview" : "Try it here"}
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
