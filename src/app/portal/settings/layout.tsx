import { getCurrentDbUser, getPortalEditAccess, resolvePortalClient, userIsClientOwner } from "@/lib/auth-guard";
import { settingsSectionsFor } from "@/config/portal-settings-sections";
import { PageHeader } from "@/components/page-header";
import { EditLockBanner } from "@/components/portal/edit-lock-banner";
import { SettingsNav } from "@/components/portal/settings-nav";

/**
 * Shared frame for every Settings section: one header, the section tabs, and
 * the staff edit-lock banner. Owner-only tabs (Team access) are hidden from
 * staff here; each page still enforces its own access.
 */
export default async function PortalSettingsLayout({ children }: { children: React.ReactNode }) {
  const { clientId } = await resolvePortalClient();
  const [me, editAccess] = await Promise.all([getCurrentDbUser(), getPortalEditAccess(clientId)]);
  const sections = settingsSectionsFor(userIsClientOwner(me, clientId));

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <SettingsNav sections={sections} />
      {!editAccess.canEdit ? (
        <EditLockBanner clientId={clientId} hasCode={editAccess.hasCode} />
      ) : null}
      {children}
    </div>
  );
}
