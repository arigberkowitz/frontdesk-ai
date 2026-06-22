import { redirect } from "next/navigation";

/** The demo moved to the first-run welcome screen, so it's no longer a portal tab.
 *  Send any old/bookmarked link back to the portal overview. */
export default function PortalDemoPage() {
  redirect("/portal");
}
