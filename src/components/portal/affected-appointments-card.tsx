"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PanelHeader } from "@/components/panel-header";
import { sendRebookOffersAction } from "@/lib/actions/rebooking";
import { initialActionState, type ActionState } from "@/lib/actions/types";

export interface AffectedRow {
  id: string;
  who: string;
  /** Pre-formatted in the business's timezone on the server. */
  when: string;
  serviceName: string | null;
  status: { label: string; tone: "muted" | "pending" | "good" | "warn" };
  /** Not yet asked (or a previous attempt was skipped/failed) — can be texted. */
  askable: boolean;
}

const TONE: Record<AffectedRow["status"]["tone"], "secondary" | "outline" | "default" | "destructive"> = {
  muted: "outline",
  pending: "secondary",
  good: "default",
  warn: "destructive",
};

/**
 * Hours page: booked appointments that a closure / time off now overlaps.
 * Blocking time never moves anyone by itself; this is where the owner sees
 * who's affected and — with an explicit confirmation — asks them to pick a
 * new time by text. Per-appointment status shows what happened next.
 */
export function AffectedAppointmentsCard({
  clientId,
  rows,
  enabled,
  canEdit,
}: {
  clientId: string;
  rows: AffectedRow[];
  enabled: boolean;
  canEdit: boolean;
}) {
  const askable = useMemo(() => rows.filter((r) => r.askable).map((r) => r.id), [rows]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(askable));
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: ActionState, fd: FormData) => {
      const next = await sendRebookOffersAction(prev, fd);
      if (next.ok) setConfirming(false);
      return next;
    },
    initialActionState,
  );

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  if (rows.length === 0) return null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chosen = askable.filter((id) => selected.has(id));

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <PanelHeader
          icon={CalendarClock}
          title="Appointments in blocked time"
          description="You've blocked time that already has bookings in it. These appointments are still on — nobody has been told anything yet."
        />

        <form action={action} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={clientId} />
          {confirming ? <input type="hidden" name="confirm" value="yes" /> : null}

          <ul className="divide-y rounded-lg border">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
                {enabled && canEdit && r.askable ? (
                  <input
                    type="checkbox"
                    name="appointmentId"
                    value={r.id}
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`Ask ${r.who} to rebook`}
                    className="size-4"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.who}</div>
                  <div className="text-muted-foreground">
                    {r.when}
                    {r.serviceName ? ` · ${r.serviceName}` : ""}
                  </div>
                </div>
                <Badge variant={TONE[r.status.tone]}>{r.status.label}</Badge>
              </li>
            ))}
          </ul>

          {!enabled ? (
            <p className="text-sm text-muted-foreground">
              Want us to text these customers a few new times to choose from?{" "}
              <Link href="/portal/settings/follow-ups" className="underline underline-offset-2">
                Turn on rebooking texts in Settings → Follow-ups
              </Link>
              . Until then, give them a call.
            </p>
          ) : !canEdit ? null : askable.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everyone here has been asked. Status updates as they reply.</p>
          ) : confirming ? (
            <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="text-sm">
                Text {chosen.length} {chosen.length === 1 ? "customer" : "customers"} now? Each gets 2–3 open times
                and can reply 1, 2 or 3 to switch, or NO to cancel. People who opted out or never agreed to texts
                are skipped — call those.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
                  Not yet
                </Button>
                <Button type="submit" size="sm" disabled={pending || chosen.length === 0}>
                  {pending ? "Sending…" : `Yes, text ${chosen.length}`}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={() => setConfirming(true)} disabled={chosen.length === 0}>
                Ask customers to rebook
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
