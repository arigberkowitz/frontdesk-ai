"use client";

import { useActionState, useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/form/native-select";
import { PanelHeader } from "@/components/panel-header";
import { saveAiTextRepliesSettingsAction } from "@/lib/actions/sms-ai";
import { initialActionState } from "@/lib/actions/types";
import { AI_REPLIES_PER_THREAD_PER_DAY, PAUSE_HOUR_CHOICES } from "@/lib/sms-ai/rules";

/**
 * Settings → Follow-ups → AI text replies. Off by default; owner/admin only.
 * The copy says plainly what it does and when it stops, because this one
 * sends model-written texts from the business's number.
 */
export function AiTextRepliesCard({
  clientId,
  enabled,
  pauseHours,
  isAdmin,
  bookingEnabled,
}: {
  clientId: string;
  enabled: boolean;
  pauseHours: number;
  isAdmin: boolean;
  bookingEnabled: boolean;
}) {
  const [state, action, pending] = useActionState(saveAiTextRepliesSettingsAction, initialActionState);
  const [on, setOn] = useState(enabled);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (!isAdmin) return null;

  return (
    <Card id="ai-text-replies" className="scroll-mt-24">
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={Bot}
          title="AI text replies"
          description="When a customer texts you, your AI answers using only your services, hours and FAQ — and can check times, book, move or cancel their appointment. Anything it isn't sure about comes straight to you."
        />
        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <label htmlFor="ai-text-enabled" className="text-sm font-medium">
              Let my AI reply to customer texts
            </label>
            <Switch id="ai-text-enabled" name="enabled" checked={on} onCheckedChange={setOn} disabled={pending} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <label htmlFor="ai-text-pause" className="text-sm">
              After I reply to someone myself, keep the AI quiet in that conversation for
            </label>
            <NativeSelect id="ai-text-pause" name="pauseHours" defaultValue={String(pauseHours)} className="w-32">
              {PAUSE_HOUR_CHOICES.map((h) => (
                <option key={h} value={h}>
                  {h} hours
                </option>
              ))}
            </NativeSelect>
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>· Only replies to people who texted you first, and never to anyone who texted STOP.</li>
            <li>· Hands the conversation to you (and emails you) when someone asks for a person, it sounds urgent or sensitive, or it isn&rsquo;t sure.</li>
            <li>· Replies only between 9am and 8pm your time; at most {AI_REPLIES_PER_THREAD_PER_DAY} AI texts per conversation a day.</li>
            <li>· Every AI text is marked &ldquo;AI&rdquo; in Messages, and you can pause it in any conversation.</li>
            <li>· It never changes your AI&rsquo;s settings, services or answers.</li>
            {bookingEnabled ? null : (
              <li>· No calendar is connected, so it can answer questions but will pass booking requests to you.</li>
            )}
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
