import { Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import {
  addAlertContactAction,
  allOnDutyAction,
  deleteAlertContactAction,
  toggleAlertContactAction,
} from "@/lib/actions/alert-contacts";
import type { AlertContact } from "@/db/schema";

/**
 * "Who gets alerts" — the business's routing roster. Alerts (bookings, leads,
 * 🚨 emergencies) go to everyone marked on duty; with nobody on duty they fall
 * back to the owner email / alert phone in the Alerts card above.
 */
export function AlertRoster({
  clientId,
  contacts,
}: {
  clientId: string;
  contacts: AlertContact[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who gets alerts</CardTitle>
        <CardDescription>
          Bookings, messages, and 🚨 emergencies go to everyone marked on duty — so the person
          actually holding the phone tonight gets the text. No one on duty? Alerts fall back to the
          owner contacts above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {contacts.length > 1 && contacts.some((c) => !c.onDuty) ? (
          <form action={allOnDutyAction}>
            <input type="hidden" name="clientId" value={clientId} />
            <Button type="submit" size="sm" variant="outline">
              Send to everyone — all on duty
            </Button>
          </form>
        ) : null}
        {contacts.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || "no contact info"}
                  </p>
                </div>
                <form action={toggleAlertContactAction}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="contactId" value={c.id} />
                  <input type="hidden" name="onDuty" value={c.onDuty ? "false" : "true"} />
                  <Button
                    type="submit"
                    size="sm"
                    variant={c.onDuty ? "default" : "outline"}
                    className="w-24"
                  >
                    {c.onDuty ? "On duty" : "Off duty"}
                  </Button>
                </form>
                <form action={deleteAlertContactAction}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="contactId" value={c.id} />
                  <Button type="submit" size="icon" variant="ghost" aria-label={`Remove ${c.name}`}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No one on the roster yet — alerts go to the owner contacts above.
          </p>
        )}

        <form action={addAlertContactAction} className="space-y-4">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <Input name="name" placeholder="Sam the tech" required />
            </Field>
            <Field label="Email (optional)">
              <Input name="email" type="email" placeholder="sam@yourbusiness.com" />
            </Field>
            <Field label="Phone (optional)">
              <Input name="phone" placeholder="+1 415 555 0100" />
            </Field>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Add person</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
