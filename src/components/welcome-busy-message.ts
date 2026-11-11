/** Status under the welcome submit button while setup runs. */
export function welcomeBusyMessage(websiteUrl: string | null | undefined): string {
  const hasSite = Boolean(String(websiteUrl ?? "").trim());
  return hasSite
    ? "Reading your website and building your receptionist — this can take up to a minute. Keep this page open."
    : "Building your receptionist — this can take up to a minute. Keep this page open.";
}
