"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { Copy, Lock, MessageCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader } from "@/components/panel-header";
import { rotateChatWidgetKeyAction, saveChatWidgetSettingsAction } from "@/lib/actions/growth-settings";
import { initialActionState } from "@/lib/actions/types";
import { WhatsThis } from "@/components/portal/feature-explainer";
import { cn } from "@/lib/utils";

export const UPGRADE_HREF = "/portal/guidelines?plans=open#plans";

export interface ChatWidgetStatsView {
  days: number;
  chats: number;
  leads: number;
  bookings: number;
}

/**
 * Website chat (Pro). Two faces:
 *
 *  - Pro (or trial / comped): one switch, the websites it may run on, the
 *    one-line embed snippet, a live preview, and the last 30 days' numbers.
 *  - Rescue / Starter: locked. A line built from this business's own call log
 *    (teaser), a preview of the bubble with their name on it, and an Upgrade
 *    to Pro button. The server refuses the chat on these plans regardless of
 *    what this card shows.
 */
export function ChatWidgetCard({
  clientId,
  isAdmin,
  appUrl,
  enabled,
  allowed,
  widgetKey,
  domains,
  teaser,
  businessName,
  agentName,
  stats,
}: {
  clientId: string;
  isAdmin: boolean;
  appUrl: string;
  enabled: boolean;
  /** The plan includes website_chat. */
  allowed: boolean;
  widgetKey: string | null;
  domains: string[];
  teaser: string;
  businessName: string;
  agentName: string;
  stats: ChatWidgetStatsView | null;
}) {
  if (!isAdmin) return null;
  if (!allowed) {
    return <LockedChatCard teaser={teaser} businessName={businessName} agentName={agentName} wasOn={enabled} />;
  }
  return (
    <ProChatCard
      clientId={clientId}
      appUrl={appUrl}
      enabled={enabled}
      widgetKey={widgetKey}
      domains={domains}
      stats={stats}
    />
  );
}

function ProChatCard({
  clientId,
  appUrl,
  enabled,
  widgetKey,
  domains,
  stats,
}: {
  clientId: string;
  appUrl: string;
  enabled: boolean;
  widgetKey: string | null;
  domains: string[];
  stats: ChatWidgetStatsView | null;
}) {
  const [state, action, pending] = useActionState(saveChatWidgetSettingsAction, initialActionState);
  const [rotateState, rotate, rotating] = useActionState(rotateChatWidgetKeyAction, initialActionState);
  const [on, setOn] = useState(enabled);

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);
  useEffect(() => {
    if (rotateState.ok && rotateState.message) toast.success(rotateState.message);
    else if (rotateState.error) toast.error(rotateState.error);
  }, [rotateState]);

  const snippet = widgetKey ? `<script src="${appUrl}/widget.js" data-key="${widgetKey}" async></script>` : null;
  const domainError = state.fieldErrors?.domains?.[0];
  const previewSrc =
    enabled && widgetKey
      ? `/widget/frame?key=${encodeURIComponent(widgetKey)}&preview=1`
      : null;

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={MessageCircle}
          title={
            <span className="inline-flex items-center gap-2">
              Chat on your website <ProBadge />
            </span>
          }
          description="The same AI that answers your phone, as a chat bubble on your site. Same services, hours, answers and booking rules. It takes leads and books into the same calendar."
        />
        <WhatsThis feature="chatWidget" className="sm:ml-12" />

        {stats && enabled ? (
          <dl className="mt-5 grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center" aria-label={`Website chat, last ${stats.days} days`}>
            <Stat label="Chats" value={stats.chats} />
            <Stat label="Leads" value={stats.leads} />
            <Stat label="Bookings" value={stats.bookings} />
            <p className="col-span-3 text-xs text-muted-foreground">Last {stats.days} days, from your website chat.</p>
          </dl>
        ) : null}

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />

          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <label htmlFor="chat-enabled" className="text-sm font-medium">
                Turn website chat on
              </label>
              <p className="text-xs text-muted-foreground">Off by default. Nothing shows on your site until this is on.</p>
            </div>
            <Switch id="chat-enabled" name="enabled" checked={on} onCheckedChange={setOn} disabled={pending} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="chat-domains" className="text-sm font-medium">
              Your website addresses
            </label>
            <Textarea
              id="chat-domains"
              name="domains"
              defaultValue={domains.join("\n")}
              placeholder={"example.com\nbook.example.com"}
              rows={3}
              aria-invalid={domainError ? true : undefined}
              aria-describedby="chat-domains-help"
              disabled={pending}
            />
            <p id="chat-domains-help" className="text-xs text-muted-foreground">
              One per line. The chat only appears on these sites, so nobody can put your AI on theirs.
              example.com also covers www.example.com. Use *.example.com for every subdomain.
            </p>
            {domainError ? (
              <p className="text-xs text-destructive" role="alert">
                {domainError}
              </p>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>

        <div className="mt-5 space-y-2 border-t pt-5">
          <p className="text-sm font-medium">
            Paste this just before <code>&lt;/body&gt;</code> on your site
          </p>
          {snippet ? (
            <>
              <div className="flex items-start gap-2">
                <code className="block min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">{snippet}</code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(snippet)
                      .then(() => toast.success("Copied."))
                      .catch(() => toast.error("Couldn't copy. Select it and copy by hand."));
                  }}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Works on Squarespace, Wix, WordPress or a hand-built site. Add{" "}
                  <code>data-accent=&quot;#yourcolor&quot;</code> to match your brand, or{" "}
                  <code>data-lang=&quot;es&quot;</code> for Spanish.
                </p>
                <form action={rotate}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <Button type="submit" variant="ghost" size="sm" disabled={rotating}>
                    <RefreshCw className="size-3.5" />
                    {rotating ? "Making…" : "New snippet"}
                  </Button>
                </form>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Turn it on and save, and your snippet shows up here.</p>
          )}
        </div>

        {previewSrc ? (
          <div className="mt-5 space-y-2 border-t pt-5">
            <p className="text-sm font-medium">Try it</p>
            <p className="text-xs text-muted-foreground">
              This is the real chat. Messages here are real too: a booking goes on your calendar and a lead goes to your Leads page.
            </p>
            <iframe
              src={previewSrc}
              title="Website chat preview"
              className="h-[480px] w-full max-w-sm rounded-xl border bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        ) : null}

        <ul className="mt-5 space-y-1 text-xs text-muted-foreground">
          <li>· Visitors can ask questions, check openings and book. It confirms details before it books.</li>
          <li>· No calendar connected? It takes their name, number and what they need, and you get the usual lead alert.</li>
          <li>· It never makes up prices. If a price isn&apos;t in your services, it says the team will confirm.</li>
          <li>· English and Spanish.</li>
        </ul>
      </CardContent>
    </Card>
  );
}

function LockedChatCard({
  teaser,
  businessName,
  agentName,
  wasOn,
}: {
  teaser: string;
  businessName: string;
  agentName: string;
  wasOn: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={MessageCircle}
          title={
            <span className="inline-flex items-center gap-2">
              Chat on your website <ProBadge />
            </span>
          }
          description="The same AI that answers your phone, as a chat bubble on your site."
        />
        <div className="mt-5 grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
          <div className="space-y-4">
            <p className="text-base font-medium leading-snug text-foreground">{teaser}</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>· Answers questions from your services, hours and FAQs</li>
              <li>· Takes name, number and what they need, and alerts you like a phone lead</li>
              <li>· Books into your calendar when one is connected</li>
              <li>· English and Spanish, and it never makes up prices</li>
            </ul>
            {wasOn ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden />
                Your website chat is paused until you&apos;re on Pro. Your settings are saved.
              </p>
            ) : null}
            <Link href={UPGRADE_HREF} className={cn(buttonVariants({ size: "sm" }), "fd-cta-glow")}>
              Upgrade to Pro
            </Link>
          </div>
          <WidgetMock businessName={businessName} agentName={agentName} />
        </div>
      </CardContent>
    </Card>
  );
}

/** A static picture of the chat with this business's name. Not interactive, no network. */
function WidgetMock({ businessName, agentName }: { businessName: string; agentName: string }) {
  return (
    <figure
      className="w-full max-w-[300px] justify-self-center overflow-hidden rounded-2xl border bg-white text-[13px] shadow-lg md:w-[300px]"
      aria-label={`Preview of the website chat for ${businessName}`}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <span className="size-2 rounded-full bg-emerald-600" aria-hidden />
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{businessName}</p>
          <p className="truncate text-[11px] text-muted-foreground">{agentName} · AI receptionist</p>
        </div>
      </div>
      <div className="space-y-2 px-3 py-3" aria-hidden>
        <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-foreground">
          Hi! I&apos;m {agentName}, the AI receptionist for {businessName}. What can I help with?
        </p>
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-white">
          Are you open Saturday?
        </p>
        <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-foreground">
          I can check that and book you in. What do you need done?
        </p>
      </div>
      <figcaption className="border-t px-3 py-2 text-[11px] text-muted-foreground">Preview. Turns on with Pro.</figcaption>
    </figure>
  );
}

function ProBadge() {
  return (
    <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
      Pro
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}
