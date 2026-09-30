import { redirect } from "next/navigation";

/** The staff board moved to /portal/staff (it was called "Team", which collided
 *  with Settings → Team access). Keep old links and bookmarks working. */
export default async function PortalTeamRedirect({
  searchParams,
}: {
  searchParams: Promise<{ as?: string }>;
}) {
  const { as } = await searchParams;
  redirect(as ? `/portal/staff?as=${encodeURIComponent(as)}` : "/portal/staff");
}
