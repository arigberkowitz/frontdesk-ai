"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<typeof Button>;

export function SubmitButton({
  pending,
  children,
  className,
  ...props
}: ButtonProps & { pending?: boolean }) {
  return (
    <Button type="submit" disabled={pending || props.disabled} className={cn(className)} {...props}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </Button>
  );
}
