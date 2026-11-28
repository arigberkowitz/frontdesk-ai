"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, PhoneOff, PlayCircle, ShieldAlert, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatPhone } from "@/lib/format";
import { ControlDialog, postControl, type ControlResponse } from "./control-dialog";

export interface OperatorControlsProps {
  clientId: string;
  name: string;
  /** Retell voice number on the business. */
  phone: string | null;
  /** Toll-free texting number the app bought (Twilio), if any. */
  textingNumber: string | null;
  agentId: string | null;
  llmId: string | null;
  /** Stripe subscription mirror, for stating what the buttons will do to billing. */
  subscription: { status: string; plan: string | null; stripeId: string | null } | null;
  suspended: { at: string; mode: "off" | "messages_only"; reason?: string; stripe: { action: "cancel" | "pause" | "none" }; deleting?: boolean } | null;
}

type Which = null | "release" | "agent" | "suspend" | "reactivate" | "delete";

/**
 * Operator-only controls (rendered on the operator's client page; every request
 * is re-authorized on the server by /api/operator/clients/[id], so a client
 * portal never gets these — and could not use them if it tried).
 */
export function OperatorControls(p: OperatorControlsProps) {
  const router = useRouter();
  const url = `/api/operator/clients/${p.clientId}`;
  const [open, setOpen] = useState<Which>(null);

  // Suspend form state
  const [mode, setMode] = useState<"off" | "messages_only">("off");
  const [stripe, setStripe] = useState<"cancel" | "pause" | "none">("cancel");
  const [prorate, setProrate] = useState(false);
  const [reason, setReason] = useState("");
  // Delete form state
  const [blockFraud, setBlockFraud] = useState(false);

  const hasSub = Boolean(p.subscription?.stripeId);
  const subWord = hasSub ? `its ${p.subscription?.plan ?? "paid"} subscription (${p.subscription?.status})` : "its Stripe subscription (none on file)";

  function done(label: string) {
    return (res: ControlResponse) => {
      router.refresh();
      if (res.ok) toast.success(label);
    };
  }
  const close = (o: boolean) => {
    if (!o) setOpen(null);
  };

  const phoneLine = p.phone ? `Release ${formatPhone(p.phone)} at Retell (it stops billing monthly)` : null;

  return (
    <Card className="border-destructive/30" data-testid="operator-controls">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <ShieldAlert className="size-4 text-destructive" aria-hidden />
          <CardTitle>Operator controls</CardTitle>
          {p.suspended ? (
            <Badge variant="destructive">{p.suspended.deleting ? "Deleting" : "Suspended"}</Badge>
          ) : null}
        </div>
        <CardDescription>
          Only you see these. They act at the vendors (Retell, Twilio, Stripe) so nothing keeps billing, and every one asks first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {p.suspended ? (
          <div role="status" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium">
              Suspended — {p.suspended.mode === "off" ? "phone line detached, the AI isn't answering" : "the AI only takes messages"}.
            </p>
            <p className="text-muted-foreground">
              Portal blocked; jobs, texts and emails skip this company. Stripe:{" "}
              {p.suspended.stripe.action === "cancel"
                ? "subscription canceled (no refund)"
                : p.suspended.stripe.action === "pause"
                  ? "billing paused"
                  : "left as is"}
              .{p.suspended.reason ? ` Reason: ${p.suspended.reason}` : ""}
            </p>
          </div>
        ) : null}

        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Phone number (Retell)</dt>
            <dd className="font-medium tabular-nums">{p.phone ? formatPhone(p.phone) : "None"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Texting number (Twilio)</dt>
            <dd className="font-medium tabular-nums">{p.textingNumber ? formatPhone(p.textingNumber) : "None"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Retell agent</dt>
            <dd className="break-all font-mono text-xs">{p.agentId ?? "None"}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOpen("release")} disabled={!p.phone && !p.textingNumber}>
            <PhoneOff className="size-4" />
            Release phone number
          </Button>
          <Button variant="outline" onClick={() => setOpen("agent")} disabled={!p.agentId && !p.llmId}>
            <Unplug className="size-4" />
            Delete agent
          </Button>
          {p.suspended && !p.suspended.deleting ? (
            <Button variant="outline" onClick={() => setOpen("reactivate")}>
              <PlayCircle className="size-4" />
              Reactivate company
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setOpen("suspend")}>
              <Ban className="size-4" />
              {p.suspended?.deleting ? "Re-run lock" : "Deactivate company"}
            </Button>
          )}
          <Button variant="destructive" onClick={() => setOpen("delete")}>
            <Trash2 className="size-4" />
            Delete company
          </Button>
        </div>
      </CardContent>

      {/* Release phone number */}
      <ControlDialog
        open={open === "release"}
        onOpenChange={close}
        title="Release this company's phone number?"
        willHappen={[
          phoneLine ?? "No Retell number on file — nothing to release there",
          p.textingNumber ? `Release the texting number ${formatPhone(p.textingNumber)} at Twilio` : "No Twilio texting number we bought",
          "Detach the number from the AI first, so it stops answering immediately",
          "Clear the number here, and stop automatic number-buying for this company",
        ]}
        note="Callers who still dial it will hear a disconnected number. If they forwarded their line to it, they need to turn forwarding off. Safe to retry."
        confirmLabel="Release number"
        send={() => postControl(url, { action: "release_number" })}
        onDone={done("Phone number released")}
      />

      {/* Delete agent */}
      <ControlDialog
        open={open === "agent"}
        onOpenChange={close}
        title="Delete this company's AI agent?"
        willHappen={[
          p.agentId ? `Delete Retell agent ${p.agentId}` : "No Retell agent on file",
          p.llmId ? `Delete its Retell LLM (prompt) ${p.llmId}` : "No Retell LLM on file",
          "Clear the agent ids here",
          p.phone ? `Detach ${formatPhone(p.phone)} from the agent (the number stays bought and billing — release it too to stop that)` : "No number attached",
        ]}
        note="The company's services, hours, knowledge and call history are not touched. Re-provisioning builds a fresh agent."
        confirmLabel="Delete agent"
        send={() => postControl(url, { action: "delete_agent" })}
        onDone={done("Agent deleted")}
      />

      {/* Suspend */}
      <ControlDialog
        open={open === "suspend"}
        onOpenChange={close}
        title="Deactivate this company?"
        willHappen={[
          "Block their portal login (they see a suspended page) and every owner action",
          "Stop crons, customer texts and owner emails for this company; drop texts already queued",
          mode === "off"
            ? "Detach the phone line from the AI — callers are turned away"
            : "Switch the AI to messages-only (no booking, no texting); no owner alerts go out",
          stripe === "cancel"
            ? `Cancel ${subWord} immediately — no refund${prorate ? ", but credit the unused time" : " and no proration"}`
            : stripe === "pause"
              ? `Pause billing on ${subWord} (void invoices while paused; resumable)`
              : "Leave Stripe alone",
          "Keep the phone number (it keeps billing at the vendor until you release it)",
        ]}
        note="Fully reversible except a canceled subscription: Reactivate restores the portal and the line, but a canceled subscription can't be undone — they'd pick a plan again."
        confirmLabel="Deactivate company"
        extra={
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-muted-foreground">Phone line</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="susp-mode" checked={mode === "off"} onChange={() => setMode("off")} />
                Off (detach the number)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="susp-mode" checked={mode === "messages_only"} onChange={() => setMode("messages_only")} />
                Messages only
              </label>
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium text-muted-foreground">Stripe subscription</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="susp-stripe" checked={stripe === "cancel"} onChange={() => setStripe("cancel")} />
                Cancel now, no refund (default)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="susp-stripe" checked={stripe === "pause"} onChange={() => setStripe("pause")} />
                Pause billing (resumable)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="susp-stripe" checked={stripe === "none"} onChange={() => setStripe("none")} />
                Leave as is
              </label>
              {stripe === "cancel" ? (
                <label className="ml-6 flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={prorate} onChange={(e) => setProrate(e.target.checked)} />
                  Credit the unused time (proration). Off = no refund, no credit.
                </label>
              ) : null}
            </fieldset>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Reason (kept in the audit log)</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Misrepresented their business" />
            </label>
          </div>
        }
        send={() => postControl(url, { action: "suspend", mode, stripe, prorate, reason: reason.trim() || undefined })}
        onDone={done("Company deactivated")}
      />

      {/* Reactivate */}
      <ControlDialog
        open={open === "reactivate"}
        onOpenChange={close}
        title="Reactivate this company?"
        tone="default"
        willHappen={[
          "Unblock their portal and restore their previous status",
          p.suspended?.mode === "off" ? "Reattach the phone line to the AI" : "Restore the full AI prompt",
          p.suspended?.stripe.action === "pause"
            ? "Resume Stripe billing"
            : p.suspended?.stripe.action === "cancel"
              ? "Stripe: the subscription was canceled and can't be restored — they'll need to pick a plan again"
              : "Stripe: untouched",
        ]}
        confirmLabel="Reactivate"
        send={() => postControl(url, { action: "reactivate" })}
        onDone={done("Company reactivated")}
      />

      {/* Delete company */}
      <ControlDialog
        open={open === "delete"}
        onOpenChange={close}
        title={`Delete ${p.name}?`}
        typeToConfirm={p.name}
        willHappen={[
          "Lock the company: portal blocked, jobs/texts/emails stop, queued texts dropped",
          phoneLine ?? "No Retell number on file",
          p.textingNumber ? `Release the Twilio texting number ${formatPhone(p.textingNumber)}` : "No Twilio texting number",
          p.agentId || p.llmId ? "Delete the Retell agent and its LLM" : "No Retell agent on file",
          `Cancel ${subWord} immediately — no refund, no proration`,
          "Hide it from every list; call data is purged on the existing 90-day schedule (billing/legal records and the audit log stay)",
          blockFraud ? "Block this owner's email, phone and company domain from starting another free trial" : "Not block them from a new free trial",
        ]}
        note="Deleting can't be undone from here. If a step fails, the company stays locked and listed so you can press Retry."
        confirmLabel="Delete company"
        extra={
          <label className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={blockFraud} onChange={(e) => setBlockFraud(e.target.checked)} />
            <span>
              Fraud flag — block this email, phone and company domain from a new free trial
              <span className="block text-xs text-muted-foreground">Use when they lied to you. Public email providers (gmail.com…) are never blocked by domain.</span>
            </span>
          </label>
        }
        send={(typed) => postControl(url, { action: "delete_company", confirm: typed, blockFraud, reason: reason.trim() || undefined })}
        onDone={done("Company deleted")}
      />
    </Card>
  );
}
