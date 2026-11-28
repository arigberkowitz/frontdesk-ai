"use client";

import { useCallback, useState } from "react";
import { Loader2, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrphanItem, OrphanKind, OrphanReport } from "@/lib/operator/orphans";
import { ControlDialog, postControl } from "./control-dialog";

const KIND_LABEL: Record<OrphanKind, string> = {
  retell_agent: "Retell agent",
  retell_llm: "Retell LLM",
  retell_number: "Phone number",
  twilio_number: "Texting number",
  stripe_subscription: "Stripe subscription",
};

const DELETE_VERB: Record<OrphanKind, string> = {
  retell_agent: "Delete this agent at Retell",
  retell_llm: "Delete this LLM at Retell",
  retell_number: "Release this number at Retell (stops its monthly billing)",
  twilio_number: "Release this number at Twilio (stops its monthly billing)",
  stripe_subscription: "Cancel this subscription at Stripe immediately — no refund, no proration",
};

/**
 * Vendor resources no active business points at. The list is read-only; each
 * row's delete button opens a confirm dialog naming exactly what will go. The
 * server re-checks that the item is still an orphan before deleting it.
 */
export function OrphansCard() {
  const [report, setReport] = useState<OrphanReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [target, setTarget] = useState<OrphanItem | null>(null);

  // Scans on click only: it asks three vendors, so it isn't done on every page view.
  const scan = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      const res = await fetch("/api/operator/orphans", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 403 ? "Platform owner only." : `Scan failed (${res.status}).`);
      setReport((await res.json()) as OrphanReport);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Card data-testid="orphans-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ScanSearch className="size-4" aria-hidden /> Orphans
              {report ? <Badge variant={report.items.length ? "destructive" : "secondary"}>{report.items.length}</Badge> : null}
            </CardTitle>
            <CardDescription>
              Things at Retell, Twilio and Stripe that no active business points at. Nothing is deleted until you click.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={scan} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {report ? "Scan again" : "Scan for orphans"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {failure ? <p className="text-sm text-destructive">{failure}</p> : null}
        {report?.notConfigured.length ? (
          <p className="text-xs text-amber-700">
            Not checked (not configured here): {report.notConfigured.join(", ")}. An empty list doesn&apos;t clear those.
          </p>
        ) : null}
        {report?.errors.map((e, i) => (
          <p key={i} className="text-xs text-destructive">
            Couldn&apos;t check {e.provider} — {e.message}
          </p>
        ))}
        {!report && !failure && !loading ? (
          <p className="text-sm text-muted-foreground">Not scanned yet. Press “Scan for orphans” — it only reads.</p>
        ) : null}
        {report && report.items.length === 0 && !report.errors.length ? (
          <p className="text-sm text-muted-foreground">Clean — every Retell agent, number and subscription belongs to an active business.</p>
        ) : null}
        {report?.items.length ? (
          <ul className="divide-y rounded-lg border">
            {report.items.map((it) => (
              <li key={`${it.kind}:${it.id}`} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{KIND_LABEL[it.kind]}</Badge>
                    <span className="truncate font-medium">{it.label}</span>
                  </div>
                  {it.detail ? <p className="mt-0.5 break-all text-xs text-muted-foreground">{it.detail}</p> : null}
                </div>
                <Button variant="destructive" size="sm" onClick={() => setTarget(it)} aria-label={`Delete ${KIND_LABEL[it.kind]} ${it.label}`}>
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>

      {target ? (
        <ControlDialog
          open
          onOpenChange={(o) => {
            if (!o) setTarget(null);
          }}
          title={`Delete ${KIND_LABEL[target.kind].toLowerCase()}?`}
          willHappen={[DELETE_VERB[target.kind], `Target: ${target.id}`, "Checked first: it must still belong to no active business"]}
          note="Already-gone counts as success. This is written to the audit log."
          confirmLabel="Delete"
          send={() => postControl("/api/operator/orphans", { kind: target.kind, id: target.id })}
          onDone={(res) => {
            if (res.ok) {
              toast.success("Orphan removed");
              void scan();
            }
          }}
        />
      ) : null}
    </Card>
  );
}
