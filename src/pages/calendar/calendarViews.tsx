import { useState, type ReactNode } from "react";
import { addDays, daysBetween, showTime, week } from "../../shared/dates";
import type { ISODate } from "../../shared/types";
import type { Act } from "../home/HomePage";
import { Tick } from "../home/Tick";
import { kindLabels } from "../alarmParts";
import { monthGrid, overdue, weekStart, type CalendarEvent } from "./calendarEvents";

/**
 * The Calendar's two views of the same events. Each gets the events by day and the week in view, and
 * reports taps up to the page: + on a day (onAdd), an event (onOpen), a week picked (onWeek).
 *   WeekColumns (desktop): the week's seven days side by side, as the meal plan lays out its days,
 *     with arrows to the weeks either side.
 *   WeekList (phone): the weeks from the one in view down, each day with something on it a block and
 *     the free days a row of small dates to add on.
 *   MonthDots: a month's grid with a dot per event; a tap picks that day's week. Beside the columns on
 *     the desktop, and the phone's other view.
 * Overdue deadlines sit on today until ticked or deleted. Colours say the kind: ember a deadline, sky an
 * alarm; red, a deadline past due.
 */

export type CalendarViewProps = {
  byDay: Map<ISODate, CalendarEvent[]>;
  today: ISODate;
  // The Monday of the week in view
  monday: ISODate;
  onWeek: (monday: ISODate) => void;
  onAdd: (date: ISODate) => void;
  onOpen: (event: CalendarEvent) => void;
  act: Act;
};

// How many weeks the phone's list shows at first, and adds each time more are asked for
const WEEKS_SHOWN = 6;

// "Tue 10 Nov"; dates are read at noon UTC, so no time zone moves them to another day
export function dayLabel(date: ISODate, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
}

// A day's events. An overdue deadline moves to today, and leaves the day it was due on.
function eventsOn(date: ISODate, byDay: Map<ISODate, CalendarEvent[]>, today: ISODate) {
  const own = byDay.get(date) ?? [];
  if (date === today) return [...overdue(byDay, today), ...own];
  return date < today ? own.filter((event) => event.kind !== "deadline") : own;
}

function weekTitle(monday: ISODate, today: ISODate) {
  const weeks = daysBetween(weekStart(today), monday) / 7;
  if (weeks === 0) return "This week";
  if (weeks === 1) return "Next week";
  if (weeks === -1) return "Last week";
  return `${dayLabel(monday, { day: "numeric", month: "short" })} – ${dayLabel(addDays(monday, 6), { day: "numeric", month: "short" })}`;
}

function dayName(date: ISODate, today: ISODate) {
  const days = daysBetween(today, date);
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : dayLabel(date, { weekday: "long" });
}

// ---- The desktop's week ----

export function WeekColumns({ byDay, today, monday, onWeek, onAdd, onOpen, act }: CalendarViewProps) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  return (
    <section className="panel-lift flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-ink/8 bg-panel p-4">
      <div className="flex items-center gap-2">
        <h1 className="caps mr-auto font-display text-[15px] font-bold text-ink/90">{weekTitle(monday, today)}</h1>
        <span className="font-mono text-[11.5px] text-muted">
          {dayLabel(monday, { day: "numeric", month: "short" })} – {dayLabel(addDays(monday, 6), { day: "numeric", month: "short", year: "numeric" })}
        </span>
        {monday === weekStart(today) ? null : (
          <button type="button" onClick={() => onWeek(weekStart(today))} className="rounded-lg border border-ink/12 px-2.5 py-1 text-[12px] text-ink/80 hover:bg-ink/6">
            This week
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <Arrow label="Previous week" onClick={() => onWeek(addDays(monday, -7))}>
          ‹
        </Arrow>
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-7 gap-2">
          {days.map((date) => (
            <DayColumn key={date} date={date} events={eventsOn(date, byDay, today)} today={today} onAdd={onAdd} onOpen={onOpen} act={act} />
          ))}
        </div>
        <Arrow label="Next week" onClick={() => onWeek(addDays(monday, 7))}>
          ›
        </Arrow>
      </div>
    </section>
  );
}

// One day of the week, as the meal plan draws one: its name and date, its events, then + to add on it
function DayColumn({ date, events, today, onAdd, onOpen, act }: { date: ISODate; events: CalendarEvent[]; today: ISODate; onAdd: (date: ISODate) => void; onOpen: (event: CalendarEvent) => void; act: Act }) {
  const offset = daysBetween(today, date);
  return (
    <div
      aria-label={dayLabel(date)}
      className={`panel-scroll flex min-h-0 min-w-0 flex-col gap-1.5 overflow-y-auto rounded-xl p-2 ${offset === 0 ? "bg-ember/[0.06] ring-1 ring-ember/30" : "bg-ink/[0.015]"} ${offset < 0 ? "opacity-70" : ""}`}
    >
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 px-1 pb-0.5">
        <span className={`truncate font-display text-[13px] font-semibold ${offset === 0 ? "text-ember" : "text-ink/85"}`}>{dayName(date, today).slice(0, offset === 0 || Math.abs(offset) === 1 ? undefined : 3)}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">{Number(date.slice(8))}</span>
      </p>
      {events.map((event) => (
        <EventCard key={event.id} event={event} today={today} onOpen={onOpen} act={act} />
      ))}
      <button type="button" onClick={() => onAdd(date)} aria-label={`Add on ${dayLabel(date)}`} className="mt-auto rounded-lg border border-dashed border-ink/10 py-1.5 text-[13px] leading-none text-muted hover:border-ember/40 hover:text-ember">
        +
      </button>
    </div>
  );
}

// An event in a day's column: its tick or bell and title, then its time and what it is
function EventCard({ event, today, onOpen, act }: { event: CalendarEvent; today: ISODate; onOpen: (event: CalendarEvent) => void; act: Act }) {
  const off = event.kind === "alarm" && !event.alarm.enabled;
  return (
    <div role="group" aria-label={event.title} className={`rounded-lg border-l-[3px] bg-ink/[0.035] px-2 py-1.5 hover:bg-ink/[0.06] ${edgeClass(event, today)} ${off ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-1.5">
        {event.kind === "deadline" ? <Tick done={false} onClick={() => void act("completeDeadline", event.id)} /> : <BellMark />}
        <button type="button" onClick={() => onOpen(event)} aria-label={`Open ${event.title}`} className="min-w-0 flex-1 text-left">
          <span className="block text-[12.5px] leading-snug text-ink/90 [overflow-wrap:anywhere]">{event.title}</span>
          <span className="block text-[10.5px] text-muted">{cardDetail(event, today, off)}</span>
        </button>
      </div>
    </div>
  );
}

function Arrow({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="w-6 shrink-0 rounded-lg text-lg text-muted hover:bg-ink/6 hover:text-ink/85">
      {children}
    </button>
  );
}

// ---- The phone's weeks ----

export function WeekList({ byDay, today, monday, onWeek, onAdd, onOpen, act }: CalendarViewProps) {
  const [weeks, setWeeks] = useState(WEEKS_SHOWN);
  return (
    <div className="flex flex-col gap-5">
      {monday === weekStart(today) ? null : (
        <button type="button" onClick={() => onWeek(weekStart(today))} className="self-start rounded-lg border border-ink/12 px-3 py-1.5 text-[12.5px] text-ink/80 hover:bg-ink/6 phone:min-h-11">
          ‹ Back to this week
        </button>
      )}
      {Array.from({ length: weeks }, (_, index) => {
        const first = addDays(monday, 7 * index);
        // Days gone by are left out, unless something is still on them
        const days = Array.from({ length: 7 }, (_, offset) => addDays(first, offset)).filter((date) => date >= today || eventsOn(date, byDay, today).length > 0);
        const busy = days.filter((date) => date === today || eventsOn(date, byDay, today).length > 0);
        const free = days.filter((date) => !busy.includes(date));
        return (
          <section key={first} aria-label={`Week of ${dayLabel(first)}`} className="space-y-3">
            <div className="flex items-center gap-3">
              <p className="caps shrink-0 font-display text-[12px] font-semibold text-muted">{weekTitle(first, today)}</p>
              <span className="h-px flex-1 bg-ink/10" />
            </div>
            {busy.map((date) => (
              <div key={date} className="flex gap-3">
                <DateBadge date={date} today={today} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  {eventsOn(date, byDay, today).map((event) => (
                    <EventRow key={event.id} event={event} today={today} onOpen={onOpen} act={act} />
                  ))}
                  {eventsOn(date, byDay, today).length ? null : <p className="px-1 py-2.5 text-[12px] text-muted">Nothing on today.</p>}
                </div>
                <button type="button" onClick={() => onAdd(date)} aria-label={`Add on ${dayLabel(date)}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-muted hover:bg-ink/6 hover:text-ember">
                  +
                </button>
              </div>
            ))}
            {free.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 pl-1">
                <span className="mr-1 text-[11px] text-muted">Free</span>
                {free.map((date) => (
                  <button key={date} type="button" onClick={() => onAdd(date)} title={`Add on ${dayLabel(date)}`} className="min-h-9 rounded-md border border-ink/10 px-2 py-1 font-mono text-[11px] text-muted hover:border-ember/40 hover:text-ember">
                    {dayLabel(date, { weekday: "short", day: "numeric" })}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
      <button type="button" onClick={() => setWeeks(weeks + WEEKS_SHOWN)} className="min-h-11 self-center rounded-lg border border-ink/12 px-3 py-1.5 text-[12.5px] text-ink/80 hover:bg-ink/6">
        Show {WEEKS_SHOWN} more weeks
      </button>
    </div>
  );
}

// A day's date as a block: its weekday over its number, ember for today
function DateBadge({ date, today }: { date: ISODate; today: ISODate }) {
  const isToday = date === today;
  return (
    <div className={`flex w-12 shrink-0 flex-col items-center self-start rounded-xl py-1.5 ${isToday ? "bg-ember/15 text-ember" : "bg-ink/[0.04] text-ink/80"}`}>
      <span className="caps text-[9.5px]">{dayLabel(date, { weekday: "short" })}</span>
      <span className="font-display text-[26px] leading-none">{Number(date.slice(8))}</span>
    </div>
  );
}

// An event as a row: a deadline with its tick, an alarm with its bell; a tap on the text opens it
function EventRow({ event, today, onOpen, act }: { event: CalendarEvent; today: ISODate; onOpen: (event: CalendarEvent) => void; act: Act }) {
  const off = event.kind === "alarm" && !event.alarm.enabled;
  return (
    <div role="group" aria-label={event.title} className={`flex items-center gap-3 rounded-xl border-l-[3px] bg-ink/[0.03] py-2 pr-3 pl-3 hover:bg-ink/[0.06] ${edgeClass(event, today)} ${off ? "opacity-50" : ""}`}>
      {event.kind === "deadline" ? <Tick done={false} onClick={() => void act("completeDeadline", event.id)} /> : <BellMark />}
      <button type="button" onClick={() => onOpen(event)} aria-label={`Open ${event.title}`} className="flex min-h-9 min-w-0 flex-1 items-center gap-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-snug text-ink/90 [overflow-wrap:anywhere]">{event.title}</span>
          <span className="block text-[11px] text-muted">{detailOf(event, today, off)}</span>
        </span>
        {event.time ? <span className="shrink-0 font-mono text-[13px] tabular-nums text-ink/80">{showTime(event.time)}</span> : null}
      </button>
    </div>
  );
}

// ---- The month ----

// A month's grid, paged; each day a number over a dot per event (up to four). The week in view is
// banded; a tap on a day picks its week. `large` fills the phone's screen.
export function MonthDots({ byDay, today, monday, onWeek, large }: CalendarViewProps & { large?: boolean }) {
  const [month, setMonth] = useState(monday.slice(0, 7));
  const days = monthGrid(`${month}-01`);
  const shift = (by: number) => setMonth(addDays(`${month}-15`, by * 30).slice(0, 7));
  const rows = Array.from({ length: days.length / 7 }, (_, row) => days.slice(row * 7, row * 7 + 7));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <h2 className={`caps mr-auto font-display font-bold text-ink/90 ${large ? "text-[15px]" : "text-[13px]"}`}>{dayLabel(`${month}-01`, { month: "long", year: "numeric" })}</h2>
        <MonthArrow label="Previous month" large={large} onClick={() => shift(-1)}>
          ‹
        </MonthArrow>
        <MonthArrow label="Next month" large={large} onClick={() => shift(1)}>
          ›
        </MonthArrow>
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {week.map((weekday) => (
          <span key={weekday} className="caps text-center text-[9.5px] text-muted">
            {weekday.slice(0, large ? 3 : 1)}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <div key={row[0]} className={`grid grid-cols-7 rounded-lg ${row[0] === monday ? "bg-ember/10 ring-1 ring-ember/30" : ""}`}>
            {row.map((date) => {
              const events = eventsOn(date, byDay, today);
              const isToday = date === today;
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => onWeek(weekStart(date))}
                  aria-label={`${dayLabel(date)}${events.length ? `, ${events.length} on it` : ""}`}
                  className={`flex flex-col items-center gap-1 rounded-lg hover:bg-ink/[0.06] ${large ? "py-2.5" : "py-1.5"} ${date.startsWith(month) ? "" : "opacity-35"}`}
                >
                  <span className={`flex items-center justify-center rounded-full font-display leading-none ${large ? "h-8 w-8 text-[19px]" : "h-6 w-6 text-[15px]"} ${isToday ? "bg-ember text-canvas" : "text-ink/85"}`}>{Number(date.slice(8))}</span>
                  <span className="flex h-1.5 gap-0.5">
                    {events.slice(0, 4).map((event) => (
                      <span key={event.id} className={`h-1.5 w-1.5 rounded-full ${dotClass(event, today)}`} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="flex gap-3 text-[10.5px] text-muted">
        <Legend dot="bg-ember">Deadline</Legend>
        <Legend dot="bg-sky-400">Alarm</Legend>
        <Legend dot="bg-red-400">Overdue</Legend>
      </p>
    </div>
  );
}

function MonthArrow({ label, large, onClick, children }: { label: string; large?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={`flex items-center justify-center rounded-lg text-lg leading-none text-ink/70 hover:bg-ink/6 ${large ? "h-11 w-11" : "h-7 w-7"}`}>
      {children}
    </button>
  );
}

function Legend({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

// ---- Shared ----

function detailOf(event: CalendarEvent, today: ISODate, off: boolean) {
  if (event.kind === "alarm") return `Alarm${event.alarm.kind === "plain" ? "" : ` · ${kindLabels[event.alarm.kind].toLowerCase()}`}${off ? " · off" : ""}`;
  // A deadline's time, shown beside it, is when its alarm rings on the day
  const days = daysBetween(today, event.date);
  const when = days < 0 ? `Due ${dayLabel(event.date)}, ${-days}d late` : "Due";
  return `${when}${event.time ? " · alarm at" : ""}`;
}

// The same, shorter, for a narrow column: an alarm's time first, a deadline's alarm last
function cardDetail(event: CalendarEvent, today: ISODate, off: boolean) {
  if (event.kind === "alarm") return `${showTime(event.time)}${event.alarm.kind === "plain" ? "" : ` · ${kindLabels[event.alarm.kind].toLowerCase()}`}${off ? " · off" : ""}`;
  const days = daysBetween(today, event.date);
  return `${days < 0 ? `${-days}d late` : "Due"}${event.time ? ` · alarm ${showTime(event.time)}` : ""}`;
}

function BellMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-px h-4 w-4 shrink-0 text-sky-300" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3L4 11ZM6.5 14a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

function edgeClass(event: CalendarEvent, today: ISODate) {
  if (event.kind === "alarm") return "border-sky-400/70";
  return event.date < today ? "border-red-400/80" : "border-ember/70";
}

function dotClass(event: CalendarEvent, today: ISODate) {
  if (event.kind === "alarm") return event.alarm.enabled ? "bg-sky-400" : "bg-ink/25";
  return event.date < today ? "bg-red-400" : "bg-ember";
}
