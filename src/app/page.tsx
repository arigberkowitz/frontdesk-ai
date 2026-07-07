import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getCurrentDbUser, operatorHomePath } from "@/lib/auth-guard";
import { LandingPage } from "@/components/landing-page";

/**
 * Root entry. Public marketing landing for visitors; signed-in users are routed
 * to where they belong — an agency operator to the admin dashboard, a self-serve
 * business owner (or client viewer) to their own portal.
 */
export default async function Home() {
  const { userId } = await auth();
  if (userId) {
    const user = await getCurrentDbUser();
    redirect(await operatorHomePath(user));
  }
  return <LandingPage />;
}
