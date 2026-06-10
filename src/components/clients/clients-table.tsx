import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./status-badge";
import { formatDateTime, formatPhone } from "@/lib/format";
import type { Client } from "@/db/schema";

export function ClientsTable({ clients }: { clients: Client[] }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Business</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Phone</TableHead>
            <TableHead className="hidden md:table-cell">Industry</TableHead>
            <TableHead className="hidden lg:table-cell">Added</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((c) => (
            <TableRow key={c.id} className="cursor-pointer">
              <TableCell className="font-medium">
                <Link href={`/clients/${c.id}`} className="block hover:underline">
                  {c.name}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={c.status} />
              </TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {formatPhone(c.retellPhoneNumber)}
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">
                {c.industry ?? "—"}
              </TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">
                {formatDateTime(c.createdAt)}
              </TableCell>
              <TableCell>
                <Link href={`/clients/${c.id}`} aria-label={`Open ${c.name}`}>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
