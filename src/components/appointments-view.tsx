"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cancelAppointmentAction } from "@/lib/actions/appointments";
import { initialActionState } from "@/lib/actions/types";
import {
  addDays,
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
  Rows3,
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
import { formatPhone } from "@/lib/format";
import {
  tzDateLong,
  tzDayKey,
  tzTime,
  tzTimeShort,
  tzTodayKey,
  zoneAbbrev,
} from "@/lib/tz";
import { AppointmentReminders, type ReminderLog } from "@/components/portal/appointment-reminders";
import { DepositRow } from "@/components/portal/deposit-row";
import { Chip, SERVICE_TONES, serviceTone, type ChipTone } from "@/components/portal/visual";

export interface CalendarAppointment {
  id: string;
  callId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  startAt: string | Date;
  endAt: string | Date | null;
  status: string;
  serviceName: string | null;
  depositStatus?: string;
  depositAmountCents?: number | null;
  /**
   * Calendar sync status, only when a Google / Outlook calendar is connected:
   * true = this appointment has an event there, false = it doesn't (added
   * before the calendar was connected, or the write failed). Undefined = no
   * own calendar connected, so nothing to show.
   */
  onCalendar?: boolean;
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

/** Status chip for anything other than a plain booking. */
const STATUS_CHIP: Record<string, { label: string; tone: ChipTone }> = {
  cancelled: { label: "Cancelled", tone: "rose" },
  no_show: { label: "No-show", tone: "amber" },
  confirmed: { label: "Confirmed", tone: "emerald" },
  completed: { label: "Completed", tone: "slate" },
};

function isOff(a: Item): boolean {
  return a.status === "cancelled" || a.status === "no_show";
}

/** "2026-09-30" → that calendar day as a plain local Date (for labels only). */
function dateFromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * One day of the agenda: a time rail on the left, each visit a card tinted
 * with its service color. Display only — tapping opens the same details
 * dialog the month grid does.
 */
function AgendaDay({
  label,
  isToday,
  items,
  timeZone,
  onSelect,
  showEmpty,
  toneOf,
}: {
  toneOf: (service: string | null) => ChipTone;
  label: string;
  isToday: boolean;
  items: Item[];
  timeZone: string;
  onSelect: (a: Item) => void;
  showEmpty: boolean;
}) {
  if (!items.length && !showEmpty) return null;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {isToday ? (
          <span className="rounded-full bg-indigo-500 bg-(image:--primary-image) px-2 py-0.5 text-[11px] font-semibold text-white shadow-(--primary-shadow)">
            Today
          </span>
        ) : null}
        <span className={cn(isToday ? "text-foreground" : "text-foreground/85")}>{label}</span>
        {items.length ? (
          <span className="text-xs font-normal text-muted-foreground">
            · {items.length} {items.length === 1 ? "visit" : "visits"}
          </span>
        ) : null}
      </h3>
      {items.length ? (
        <ol className="fd-rail space-y-2">
          {items.map((a) => {
            const tone = isOff(a) ? "slate" : toneOf(a.serviceName);
            const mins = a.endDate ? Math.round((a.endDate.getTime() - a.date.getTime()) / 60_000) : null;
            const status = STATUS_CHIP[a.status];
            return (
              <li key={a.id} className="relative grid grid-cols-[4.25rem_1fr] gap-x-4">
                <div className="pt-2.5 text-right">
                  <p className="text-xs font-semibold whitespace-nowrap tabular-nums">{tzTime(a.date, timeZone)}</p>
                  {mins && mins > 0 ? (
                    <p className="text-[11px] text-muted-foreground tabular-nums">{mins} min</p>
                  ) : null}
                </div>
                <span aria-hidden data-tone={tone} className="fd-rail-dot" />
                <button
                  type="button"
                  onClick={() => onSelect(a)}
                  data-tone={tone}
                  className="fd-event fd-lift flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl px-3.5 py-2.5 text-left outline-none ring-1 ring-(color:--card-ring) focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className={cn("block truncate text-sm font-medium", isOff(a) && "text-muted-foreground line-through")}>
                      {a.customerName ?? "Caller"}
                    </span>
                    {a.customerPhone ? (
                      <span className="block text-xs text-muted-foreground tabular-nums">
                        {formatPhone(a.customerPhone)}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {a.serviceName ? (
                      <Chip tone={tone} dot>
                        {a.serviceName}
                      </Chip>
                    ) : null}
                    {status ? <Chip tone={status.tone}>{status.label}</Chip> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="pl-[5.25rem] text-xs text-muted-foreground">Nothing booked.</p>
      )}
    </section>
  );
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
  calendarLabel,
}: {
  appointments: CalendarAppointment[];
  /** "Google Calendar" / "Outlook" when one is connected — shows per-appointment sync status. */
  calendarLabel?: string | null;
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

  const [view, setView] = useState<"week" | "calendar" | "list">("week");
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

  // Week agenda: opens on the business's current week.
  const [weekStart, setWeekStart] = useState(() => startOfWeek(dateFromDayKey(todayKey)));
  const weekDays = eachDayOfInterval({ start: weekStart, end: addDays(weekStart, 6) });
  const thisWeek = startOfWeek(dateFromDayKey(todayKey)).getTime() === weekStart.getTime();
  const listDays = useMemo(() => [...byDay.keys()].sort(), [byDay]);
  // Each service keeps one color across the whole screen. Assigned in name
  // order so the palette is spread evenly (a plain hash can give two services
  // the same color).
  const toneOf = useMemo(() => {
    const names = [...new Set(items.map((a) => a.serviceName).filter((n): n is string => Boolean(n)))].sort();
    const map = new Map(names.map((n, i) => [n, SERVICE_TONES[i % SERVICE_TONES.length]]));
    return (name: string | null) => (name ? (map.get(name) ?? serviceTone(name)) : "slate");
  }, [items]);

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month)),
    end: endOfWeek(endOfMonth(month)),
  });

  const tab = "fd-tab flex items-center gap-1.5 px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const navBtn =
    "inline-flex size-8 items-center justify-center rounded-full border bg-card text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="fd-tabs inline-flex" role="group" aria-label="View">
          <button
            type="button"
            onClick={() => setView("week")}
            aria-current={view === "week" ? "page" : undefined}
            className={tab}
          >
            <Rows3 className="size-4" />
            Week
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            aria-current={view === "calendar" ? "page" : undefined}
            className={tab}
          >
            <CalendarDays className="size-4" />
            Month
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-current={view === "list" ? "page" : undefined}
            className={tab}
          >
            <ListIcon className="size-4" />
            All
          </button>
        </div>

        {/* Say which clock these times are on. Without it, an owner checking the
            portal from another state can't tell whether 2:00 PM means their
            time or the shop's. */}
        <span className="order-last w-full text-xs text-muted-foreground sm:order-none sm:w-auto">
          All times in {zoneLabel}
        </span>

        {view === "week" ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              aria-label="Previous week"
              className={navBtn}
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-[9.5rem] text-center font-heading text-sm font-semibold tabular-nums">
              {format(weekStart, "MMM d")} – {format(addDays(weekStart, 6), "MMM d")}
            </span>
            <button
              type="button"
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              aria-label="Next week"
              className={navBtn}
            >
              <ChevronRight className="size-4" />
            </button>
            {!thisWeek ? (
              <button
                type="button"
                onClick={() => setWeekStart(startOfWeek(dateFromDayKey(todayKey)))}
                className="ml-1 rounded-full border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                This week
              </button>
            ) : null}
          </div>
        ) : null}

        {view === "calendar" ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, -1))}
              aria-label="Previous month"
              className={navBtn}
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-[9.5rem] text-center font-heading text-sm font-semibold tabular-nums">
              {format(month, "MMMM yyyy")}
            </span>
            <button
              type="button"
              onClick={() => setMonth((m) => addMonths(m, 1))}
              aria-label="Next month"
              className={navBtn}
            >
              <ChevronRight className="size-4" />
            </button>
            {/* Once you've paged away there's otherwise no way back without a
                reload. Hidden when it would do nothing. */}
            {!isSameMonth(month, monthFromDayKey(todayKey)) ? (
              <button
                type="button"
                onClick={() => setMonth(monthFromDayKey(todayKey))}
                className="ml-1 rounded-full border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                Today
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {view === "week" ? (
        <div className="fd-panel space-y-5 p-4 sm:p-5">
          {weekDays.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            return (
              <AgendaDay
                key={key}
                label={format(day, "EEEE, MMM d")}
                isToday={key === todayKey}
                items={byDay.get(key) ?? []}
                timeZone={timeZone}
                onSelect={setSelected}
                showEmpty
                toneOf={toneOf}
              />
            );
          })}
        </div>
      ) : view === "calendar" ? (
        <div className="fd-glass overflow-hidden rounded-2xl border bg-card">
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
                    "min-h-20 border-b border-r border-border/70 p-1.5 [&:nth-child(7n)]:border-r-0",
                    !inMonth && "bg-muted/30",
                    key === todayKey && "bg-brand-soft/60",
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 flex justify-end text-xs",
                      inMonth ? "text-muted-foreground" : "text-muted-foreground/40",
                    )}
                  >
                    {format(day, "yyyy-MM-dd") === todayKey ? (
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary bg-(image:--primary-image) text-[11px] font-semibold text-primary-foreground shadow-(--primary-shadow)">
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
                        data-tone={isOff(a) ? undefined : toneOf(a.serviceName)}
                        className={cn(
                          "block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                          isOff(a)
                            ? "bg-muted text-muted-foreground line-through hover:bg-muted/80"
                            : "fd-cal-pill",
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
        <div className="fd-panel space-y-5 p-4 sm:p-5">
          {listDays.map((key) => (
            <AgendaDay
              key={key}
              label={format(dateFromDayKey(key), "EEEE, MMM d, yyyy")}
              isToday={key === todayKey}
              items={byDay.get(key) ?? []}
              timeZone={timeZone}
              onSelect={setSelected}
              showEmpty={false}
              toneOf={toneOf}
            />
          ))}
        </div>
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
                  <dd className="font-medium tabular-nums">
                    {selected.customerPhone ? formatPhone(selected.customerPhone) : "—"}
                  </dd>
                </div>
                {calendarLabel && selected.onCalendar !== undefined && !isOff(selected) ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Your calendar</dt>
                    <dd>
                      {selected.onCalendar ? (
                        <Chip tone="emerald">On {calendarLabel}</Chip>
                      ) : (
                        <Chip tone="amber">Not on {calendarLabel}</Chip>
                      )}
                    </dd>
                  </div>
                ) : null}
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
              {clientId && selected.depositStatus && selected.depositStatus !== "not_required" ? (
                <DepositRow
                  key={`dep-${selected.id}`}
                  clientId={clientId}
                  appointmentId={selected.id}
                  status={selected.depositStatus}
                  amountCents={selected.depositAmountCents ?? null}
                />
              ) : null}
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
