import type { Metadata } from "next";
import { SignInPage } from "@/components/ui/sign-in-flow-1";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return <SignInPage />;
}
