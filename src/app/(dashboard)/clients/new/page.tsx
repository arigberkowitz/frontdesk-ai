import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, PencilLine, Sparkles } from "lucide-react";
import { requireOperator } from "@/lib/auth-guard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewClientForm } from "@/components/clients/new-client-form";
import { OnboardWebsiteForm } from "@/components/clients/onboard-website-form";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireOperator();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button
        variant="ghost"
        size="sm"
        render={<Link href="/clients" />}
        nativeButton={false}
        className="-ml-2"
      >
        <ArrowLeft className="size-4" />
        Clients
      </Button>
      <PageHeader
        title="New client"
        description="Draft the AI receptionist from the business's website, or enter details by hand."
      />
      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="ai">
            <TabsList className="mb-5">
              <TabsTrigger value="ai">
                <Sparkles className="size-4" />
                From website
              </TabsTrigger>
              <TabsTrigger value="manual">
                <PencilLine className="size-4" />
                Manual
              </TabsTrigger>
            </TabsList>
            <TabsContent value="ai">
              <OnboardWebsiteForm />
            </TabsContent>
            <TabsContent value="manual">
              <NewClientForm />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
