"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cancelAppointmentAction } from "@/lib/actions/appointments";
import { initialActionState } from "@/lib/actions/types";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  CalendarPlus,
  CalendarX,
  ChevronLeft,
  ChevronRight,
  Download,
  List as ListIcon,
  Phone,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  tzDateLong,
  tzDateTime,
  tzDayKey,
  tzTime,
  tzTimeShort,
  tzTodayKey,
  zoneAbbrev,
} from "@/lib/tz";
import { AppointmentReminders, type ReminderLog } from "@/components/portal/appointment-reminders";

export interface CalendarAppointment {
  id: string;
  callId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  startAt: string | Date;
  endAt: string | Date | null;
  status: string;
  serviceName: string | null;
}

type Item = CalendarAppointment & { date: Date; endDate: Date | null };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Add to Google Calendar" deep link — pre-fills an event the caller can save. */
function gcalUrl(a: Item): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = a.endDate ?? new Date(a.date.getTime() + 30 * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${a.serviceName ?? "Appointment"}${a.customerName ? ` — ${a.customerName}` : ""}`,
    dates: `${fmt(a.date)}/${fmt(end)}`,
    details: `Booked by your AI receptionist.${a.customerPhone ? ` Phone: ${a.customerPhone}.` : ""}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Universal .ics download (Apple Calendar / Outlook) as a data URI. */
function icsHref(a: Item): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = a.endDate ?? new Date(a.date.getTime() + 30 * 60_000);
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FrontDesk AI//EN",
    "BEGIN:VEVENT",
    `UID:${a.id}@frontdesk-ai`,
    `DTSTAMP:${fmt(a.date)}`,
    `DTSTART:${fmt(a.date)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(`${a.serviceName ?? "Appointment"}${a.customerName ? ` — ${a.customerName}` : ""}`)}`,
    `DESCRIPTION:${esc(`Booked by your AI receptionist.${a.customerPhone ? ` Phone: ${a.customerPhone}.` : ""}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join("\r\n"))}`;
}

/** Two-step cancel: first click arms, second confirms — no accidental cancellations. */
function CancelAppointmentButton({
  clientId,
  appointmentId,
  onCancelled,
}: {
  clientId: string;
  appointmentId: string;
  onCancelled: () => void;
}) {
  const [armed, setArmed] = useState(false);
  // Toast + close from the transition itself — an effect calling setState here
  // would trip react-hooks/set-state-in-effect.
  const [, action, pending] = useActionState(
    async (prev: typeof initialActionState, formData: FormData) => {
      const next = await cancelAppointmentAction(prev, formData);
      if (next.ok) {
        if (next.message) toast.success(next.message);
        onCancelled();
      } else if (next.error) {
        toast.error(next.error);
      }
      return next;
    },
    initialActionState,
  );

  return (
    <form action={action}>
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="appointmentId" value={appointmentId} />
      {armed ? (
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          <CalendarX className="size-4" />
          {pending ? "Cancelling…" : "Yes, cancel it"}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setArmed(true)}
        >
          <CalendarX className="size-4" />
          Cancel appointment
        </Button>
      )}
    </form>
  );
}

/** "2026-08-03" → the first of that month, as a plain calendar Date. */
function monthFromDayKey(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

export function AppointmentsView({
  appointments,
  callBasePath,
  clientId,
  reminders,
  timeZone,
}: {
  appointments: CalendarAppointment[];
  /** Base path for the source-call link, e.g. "/portal/calls" or "/clients/<id>/calls". */
  callBasePath?: string;
  /** When set, enables per-appointment reminder controls (portal). */
  clientId?: string;
  /** Reminder history keyed by appointment id. */
  reminders?: Record<string, ReminderLog[]>;
  /**
   * The BUSINESS's timezone. Every time on this screen renders in it, so the
   * portal, the confirmation email and the caller all say the same clock time
   * no matter where the viewer happens to be sitting.
   */
  timeZone: string;
}) {
  const items: Item[] = useMemo(
    () =>
      appointments
        .map((a) => ({
          ...a,
          date: new Date(a.startAt),
          endDate: a.endAt ? new Date(a.endAt) : null,
        }))
        .sort((x, y) => x.date.getTime() - y.date.getTime()),
    [appointments],
  );

  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [selected, setSelected] = useState<Item | null>(null);
  // Snapshot once on mount — render-time Date.now() violates react-hooks/purity.
  const [now] = useState(() => Date.now());
  const [todayKey] = useState(() => tzTodayKey(timeZone));
  const [zoneLabel] = useState(() => zoneAbbrev(timeZone));
  /**
   * Open on the CURRENT month, in the business's timezone.
   *
   * This used to open on the month of the first appointment in the list, so a
   * calendar with an old booking in it opened in the past and looked frozen —
   * and with no appointments at all the fallback was `new Date(0)`, which put
   * people in January 1970. Derived from the same tz day-key the grid uses, so
   * a viewer in another timezone still sees the business's month.
   */
  const [month, setMonth] = useState(() => monthFromDayKey(todayKey));

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const a of items) {
      const key = tzDayKey(a.date, timeZone);
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [items, timeZone]);

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  });

  const tab = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
      active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border p-0.5">
          <button type="button" onClick={() => setView("calendar")} className={tab(view === "calendar")}>
            <CalendarDays className="size-4" />
            Calendar
          </button>
          <button type="button" onClick={() => setView("list")} className={tab(view === "list")}>
            <ListIcon className="size-4" />
            List
          </button>
        </div>

        {/* Say which clock these times are on. Without it, an owner checking the
            portal from another state can't tell whether 2:00 PM means their
            time or the shop's. */}
        <span className="text-xs text-muted-foreground">
          All times in {zoneLabel}
        </span>

        {view === "calendar" ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, -1))}
              aria-label="Previous month"
              className="inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-[9.5rem] text-center text-sm font-medium tabular-nums">
              {format(month, "MMMM yyyy")}
            </span>
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
              className="inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className="size-4" />
            </button>
            {/* Once you've paged away there's otherwise no way back without a
                reload. Hidden when it would do nothing. */}
            {!isSameMonth(month, monthFromDayKey(todayKey)) ? (
              <button
                type="button"
                onClick={() => setMonth(monthFromDayKey(todayKey))}
                className="ml-1 rounded-md border px-2 py-1.5 text-xs font-medium text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                Today
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {view === "calendar" ? (
        <div className="overflow-hidden rounded-xl border">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayAppts = byDay.get(key) ?? [];
              const inMonth = isSameMonth(day, month);
              return (
                <div
                  key={key}
                  className={cn(
                    "min-h-20 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0",
                    !inMonth && "bg-muted/20",
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 flex justify-end text-xs",
                      inMonth ? "text-muted-foreground" : "text-muted-foreground/40",
                    )}
                  >
                    {format(day, "yyyy-MM-dd") === todayKey ? (
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                        {format(day, "d")}
                      </span>
                    ) : (
                      format(day, "d")
                    )}
                  </div>
                  <div className="space-y-1">
                    {dayAppts.slice(0, 3).map((a) => (
                      <button
                        type="button"
                        key={a.id}
                        onClick={() => setSelected(a)}
                        title={`${a.customerName ?? "Caller"}${a.serviceName ? ` · ${a.serviceName}` : ""} · ${tzTime(a.date, timeZone)}`}
                        className={cn(
                          "block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] leading-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                          a.status === "cancelled" || a.status === "no_show"
                            ? "bg-muted text-muted-foreground line-through hover:bg-muted/80"
                            : "bg-primary/10 text-foreground hover:bg-primary/20",
                        )}
                      >
                        <span className="font-medium tabular-nums">{tzTimeShort(a.date, timeZone)}</span>{" "}
                        {a.customerName ?? "Caller"}
                      </button>
                    ))}
                    {dayAppts.length > 3 ? (
                      <div className="px-1 text-[11px] text-muted-foreground">
                        +{dayAppts.length - 3} more
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border">
          {items.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setSelected(a)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <div>
                  <p className="font-medium">{a.customerName ?? "Caller"}</p>
                  <p className="text-sm text-muted-foreground">
                    {a.serviceName ? `${a.serviceName} · ` : ""}
                    {tzDateTime(a.date, timeZone)}
                    {a.customerPhone ? ` · ${a.customerPhone}` : ""}
                  </p>
                </div>
                <Badge variant="secondary" className="capitalize">
                  {a.status.replace("_", " ")}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.customerName ?? "Appointment"}</DialogTitle>
            <DialogDescription>
              {selected ? tzDateLong(selected.date, timeZone) : ""}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <>
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Service</dt>
                  <dd className="font-medium">{selected.serviceName ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Time</dt>
                  <dd className="font-medium tabular-nums">{tzTime(selected.date, timeZone)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd className="font-medium tabular-nums">{selected.customerPhone ?? "—"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <Badge variant="secondary" className="capitalize">
                      {selected.status.replace("_", " ")}
                    </Badge>
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<a href={gcalUrl(selected)} target="_blank" rel="noreferrer" />}
                >
                  <CalendarPlus className="size-4" />
                  Add to calendar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<a href={icsHref(selected)} download="appointment.ics" />}
                >
                  <Download className="size-4" />
                  .ics
                </Button>
                {selected.callId && callBasePath ? (
                  <Button
                    variant="outline"
                    size="sm"
                    nativeButton={false}
                    render={<Link href={`${callBasePath}/${selected.callId}`} />}
                  >
                    <Phone className="size-4" />
                    View call
                  </Button>
                ) : null}
                {clientId &&
                (selected.status === "booked" || selected.status === "confirmed") &&
                selected.date.getTime() > now ? (
                  <CancelAppointmentButton
                    key={selected.id}
                    clientId={clientId}
                    appointmentId={selected.id}
                    onCancelled={() => setSelected(null)}
                  />
                ) : null}
              </div>
              {clientId && selected.status !== "cancelled" && selected.status !== "no_show" ? (
                <AppointmentReminders
                  clientId={clientId}
                  appointmentId={selected.id}
                  phone={selected.customerPhone}
                  reminders={reminders?.[selected.id] ?? []}
                />
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
