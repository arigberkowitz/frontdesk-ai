"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { legacySettingsHashTarget } from "@/config/portal-settings-sections";

/**
 * Settings used to be one long page with #anchors (#calendar, #forwarding,
 * #weekly-summary, #help…). Emails already sent and old bookmarks still use
 * them, and a #hash never reaches the server — so the moved-to section is
 * resolved here, in the browser, on /portal/settings only.
 */
export function LegacySettingsHash() {
  const router = useRouter();
  useEffect(() => {
    const target = legacySettingsHashTarget(window.location.hash);
    if (target) router.replace(target);
  }, [router]);
  return null;
}
