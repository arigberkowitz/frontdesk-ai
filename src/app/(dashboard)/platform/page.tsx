import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth-guard";
import { listAllWorkspaces } from "@/lib/data/platform";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/clients/status-badge";
import { AdoptWorkspace } from "@/components/platform/adopt-workspace";
import { LocalDateTime } from "@/components/local-datetime";
import type { ClientStatus } from "@/db/schema";

export const metadata: Metadata = { title: "Platform" };

export default async function PlatformPage() {
  const admin = await requireSuperAdmin();
  const workspaces = await listAllWorkspaces();
  const selfServe = workspaces.filter((w) => w.kind === "business").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform"
        description={`Every company that's signed up for FrontDesk AI — one workspace is created per signup, not per login. ${workspaces.length} total, ${selfServe} self-serve.`}
      />

      <div className="space-y-3">
        {workspaces.map((w) => (
          <Card key={w.orgId}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{w.name}</p>
                  <Badge variant={w.kind === "agency" ? "default" : "secondary"}>
                    {w.kind === "agency" ? "Agency" : "Business"}
                  </Badge>
                  {w.domain ? (
                    <span className="text-xs text-muted-foreground">@{w.domain}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    Signed up <LocalDateTime iso={w.createdAt.toISOString()} />
                  </span>
                  {w.kind !== "agency" ? <AdoptWorkspace orgId={w.orgId} name={w.name} /> : null}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground tabular-nums">{w.members}</span>{" "}
                  {w.members === 1 ? "member" : "members"}
                </span>
                <span>
                  <span className="font-medium text-foreground tabular-nums">
                    {w.businesses.length}
                  </span>{" "}
                  {w.businesses.length === 1 ? "business" : "businesses"}
                </span>
              </div>

              {w.businesses.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {w.businesses.map((b) =>
                    w.orgId === admin.orgId ? (
                      <Link
                        key={b.id}
                        href={`/clients/${b.id}`}
                        className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
                      >
                        <span>{b.name}</span>
                        <StatusBadge status={b.status as ClientStatus} />
                      </Link>
                    ) : (
                      <div
                        key={b.id}
                        className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                      >
                        <span>{b.name}</span>
                        <StatusBadge status={b.status as ClientStatus} />
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">No business set up yet.</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
