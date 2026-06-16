import { requireAgencyOperator, isSuperAdmin } from "@/lib/auth-guard";
import { listClients } from "@/lib/data/clients";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopbar } from "@/components/app-topbar";

/**
 * Operator shell. `requireOperator()` gates every dashboard route and bootstraps
 * the operator + agency org on first login. Calling `auth()` makes this subtree
 * dynamic, so nothing here is statically prerendered at build.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAgencyOperator();
  const superAdmin = isSuperAdmin(user);
  const clients = (await listClients(user.orgId)).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar superAdmin={superAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar clients={clients} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
