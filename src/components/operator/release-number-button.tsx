"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatPhone } from "@/lib/format";
import { ControlDialog, postControl } from "./control-dialog";

/**
 * "Delete number" for the AI agent card (operator pages only; the route
 * re-authorizes on the server). Releases just the Retell voice number so it
 * stops billing; the agent stays, so browser test calls keep working.
 */
export function ReleaseNumberButton({ clientId, phone }: { clientId: string; phone: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const shown = phone ? formatPhone(phone) : null;

  return (
    <>
      <Button type="button" variant="outline" className="text-destructive" disabled={!phone} onClick={() => setOpen(true)}>
        <PhoneOff className="size-4" />
        Delete number
      </Button>
      <ControlDialog
        open={open}
        onOpenChange={setOpen}
        title={shown ? `Delete ${shown}?` : "Delete this number?"}
        willHappen={[
          shown ? `Release ${shown} at Retell — this stops its $2/mo fee` : "Release the number at Retell",
          "This can't be undone: you can't get this exact number back",
          "The AI agent stays, so browser test calls keep working",
          "Clear the number here and stop the app from buying a replacement on its own (re-provisioning on purpose is still allowed)",
        ]}
        note="Callers who still dial it will hear a disconnected number; if they forwarded their line to it they need to turn forwarding off. Written to the audit log. Safe to retry."
        confirmLabel="Delete number"
        send={() => postControl(`/api/operator/clients/${clientId}`, { action: "release_voice_number" })}
        onDone={(res) => {
          router.refresh();
          if (res.ok) toast.success("Number deleted");
        }}
      />
    </>
  );
}
