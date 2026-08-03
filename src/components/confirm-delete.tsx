"use client";

import { type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * A delete that asks first.
 *
 * Services, FAQs, alert contacts and team members were all one stray click from
 * gone, with no undo anywhere in the product. The click targets are small,
 * they sit beside Edit, and on a phone they're a thumb's width apart. Deleting
 * a service the receptionist quotes from is not a small mistake, and "it's only
 * one click" is a feature exactly until the first time it isn't.
 *
 * The form and its hidden inputs are passed as children so each call site keeps
 * its own server action.
 */
export function ConfirmDelete({
  title,
  description,
  triggerLabel,
  triggerVariant = "icon",
  children,
}: {
  title: string;
  description: string;
  /** Accessible name for the trigger — say what will be deleted. */
  triggerLabel: string;
  /** "icon" for a trash button in a row; "text" for a labelled button. */
  triggerVariant?: "icon" | "text";
  /** The confirm control's form: hidden inputs plus the submit button. */
  children: ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          triggerVariant === "icon" ? (
            <Button variant="ghost" size="icon" aria-label={triggerLabel}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={triggerLabel}
              className="text-muted-foreground hover:text-destructive"
            >
              {triggerLabel}
            </Button>
          )
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {children}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { AlertDialogAction as ConfirmDeleteAction };
