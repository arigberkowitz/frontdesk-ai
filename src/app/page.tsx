import { redirect } from "next/navigation";
import { getCurrentDbUser, operatorHomePath } from "@/lib/auth-guard";

/**
 * Root entry. The Clerk proxy sends unauthenticated visitors to /sign-in. Signed-in
 * users are routed to where they belong: an agency operator to the admin dashboard,
 * a self-serve business owner (or client viewer) to their own portal.
 */
export default async function Home() {
  const user = await getCurrentDbUser();
  redirect(await operatorHomePath(user));
}
