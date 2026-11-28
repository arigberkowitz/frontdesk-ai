"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flame, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ControlDialog, postControl } from "./control-dialog";

export interface DeletedBusinessRow {
  id: string;
  name: string;
  deletedAt: string;
  holds: string[];
}

/**
 * Businesses that are hidden from every list but still in the database (closed by
 * their owner, or deleted here) until the 90-day purge. "Permanently delete now"
 * re-checks Retell, Twilio and Stripe and then erases the records immediately.
 */
export function DeletedBusinessesCard({ rows }: { rows: DeletedBusinessRow[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<DeletedBusinessRow | null>(null);
  const [purged, setPurged] = useState(false);

  if (rows.length === 0) return null;
  return (
    <Card data-testid="deleted-businesses-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="size-4" aria-hidden /> Deleted businesses
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
        <CardDescription>
          Hidden from every list, records kept until the 90-day purge. Permanently delete now checks every vendor first, then erases them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-muted-foreground">
                Deleted {new Date(r.deletedAt).toLocaleDateString()}
                {r.holds.length ? (
                  <span className="text-destructive"> · still points at: {r.holds.join(", ")}</span>
                ) : (
                  " · nothing at the vendors on file"
                )}
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setTarget(r)}>
              <Flame className="size-4" />
              Permanently delete now
            </Button>
          </div>
        ))}
      </CardContent>
      {target ? (
        <ControlDialog
          key={target.id}
          open
          onOpenChange={(o) => {
            if (o) return;
            setTarget(null);
            if (purged) {
              setPurged(false);
              router.refresh();
            }
          }}
          title={`Permanently delete ${target.name} — everything, right now?`}
          typeToConfirm={target.name}
          willHappen={[
            "Release any number, delete any agent and LLM, revoke any calendar token, and cancel any subscription still tied to it",
            "Void unpaid invoices, remove pending charges, cancel schedules and open checkouts",
            "Ask Retell, Twilio and Stripe again what they hold, and stop unless every count is zero",
            "Then erase its calls, leads, messages, knowledge, customers' numbers, portal users and audit trail, and Retell's copies of the calls. Only a receipt (id, name, who, when) stays; billing records stay in Stripe",
          ]}
          note="This can't be undone."
          confirmLabel="Permanently delete now"
          send={(typed) => postControl(`/api/operator/clients/${target.id}`, { action: "permanent_delete", confirm: typed, blockFraud: false })}
          onDone={(res) => {
            if (res.ok) {
              setPurged(true);
              toast.success("Permanently deleted");
            } else {
              router.refresh();
            }
          }}
        />
      ) : null}
    </Card>
  );
}
