import { useState, type ReactNode } from "react";
import { addDays, clockAfter, daysBetween, showTime, week } from "../../shared/dates";
import { nowPlace } from "../../shared/schedule";
import type { ISODate } from "../../shared/types";
import type { Act } from "../home/HomePage";
import { Tick } from "../home/Tick";
import { kindLabels } from "../alarmParts";
import { NowAcross, NowLine } from "../DayRings";
import { dayEvents, monthGrid, overdue, weekStart, type CalendarDays, type CalendarEvent } from "./calendarEvents";

/**
 * The Calendar's two views of the same events. Each gets the events by day and the week in view, and
 * reports taps up to the page: an event (onOpen), a week picked (onWeek), a day's name to see the whole
 * day, every ring in it (onDay). Adding is the page's one + button.
 *   WeekColumns (desktop): the week's seven days side by side, as the meal plan lays out its days,
 *     with arrows to the weeks either side.
 *   WeekList (phone, narrow desktop): the weeks from the one in view down, each day with something on
 *     it a heading over its events, the free days a row of small dates.
 *   MonthDots: a month's grid with a dot per event; a tap picks that day's week. Beside the columns on
 *     the desktop, and the phone's other view.
 * Overdue deadlines sit on today until ticked or deleted. Colours say the kind: ember a deadline, sky an
 * alarm, green an event; red, a deadline past due. On today a blue line marks now, between rows or across
 * an event that is on (nowPlace), and the alarms that have rung and the events that have ended are greyed.
 */

export type CalendarViewProps = {
  calendar: CalendarDays;
  today: ISODate;
  // The Monday of the week in view
  monday: ISODate;
  onWeek: (monday: ISODate) => void;
  onOpen: (event: CalendarEvent) => void;
  onDay: (date: ISODate) => void;
  now: Date;
  act: Act;
};

// How many weeks the phone's list shows at first, and adds each time more are asked for
const WEEKS_SHOWN = 6;

// "Tue 10 Nov"; dates are read at noon UTC, so no time zone moves them to another day
export function dayLabel(date: ISODate, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
}

// A day's events. An overdue deadline moves to today, and leaves the day it was due on.
function eventsOn(date: ISODate, calendar: CalendarDays, today: ISODate) {
  const own = dayEvents(calendar, date);
  if (date === today) return [...overdue(calendar.byDay, today), ...own];
  return date < today ? own.filter((event) => event.kind !== "deadline") : own;
}

// An alarm whose moment has passed, or an event that has ended
function over(event: CalendarEvent, now: Date) {
  if (event.kind === "deadline") return false;
  return event.at.getTime() + (event.kind === "event" ? (event.event.minutes ?? 0) : 0) * 60_000 <= now.getTime();
}

// Where the line for now goes among today's events; the deadlines, which have no time, are above it
function nowAmong(events: CalendarEvent[], now: Date) {
  return nowPlace(
    events.map((event) => (event.kind === "deadline" ? { at: new Date(0) } : { at: event.at, minutes: event.kind === "event" ? event.event.minutes : null })),
    now,
  );
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

export function WeekColumns({ calendar, today, monday, onWeek, onOpen, onDay, now, act }: CalendarViewProps) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
            <DayColumn key={date} date={date} events={eventsOn(date, calendar, today)} today={today} now={now} onOpen={onOpen} onDay={onDay} act={act} />
          ))}
        </div>
        <Arrow label="Next week" onClick={() => onWeek(addDays(monday, 7))}>
          ›
        </Arrow>
      </div>
    </section>
  );
}

// One day of the week, as the meal plan draws one: its name and date (a tap opens the day), its
// events
function DayColumn({ date, events, today, now, onOpen, onDay, act }: { date: ISODate; events: CalendarEvent[]; today: ISODate; now: Date; onOpen: (event: CalendarEvent) => void; onDay: (date: ISODate) => void; act: Act }) {
  const offset = daysBetween(today, date);
  const place = offset === 0 ? nowAmong(events, now) : null;
  return (
    <div
      aria-label={dayLabel(date)}
      className={`panel-scroll flex min-h-0 min-w-0 flex-col gap-1.5 overflow-y-auto rounded-xl p-2 ${offset === 0 ? "bg-ember/[0.06] ring-1 ring-ember/30" : "bg-ink/[0.015]"} ${offset < 0 ? "opacity-70" : ""}`}
    >
      <button type="button" onClick={() => onDay(date)} aria-label={`See ${offset === 0 ? "today" : dayLabel(date)}`} title="See the whole day" className="flex flex-wrap items-baseline justify-between gap-x-2 rounded-md px-1 pb-0.5 text-left hover:bg-ink/6">
        <span className={`truncate font-display text-[13px] font-semibold ${offset === 0 ? "text-ember" : "text-ink/85"}`}>{dayName(date, today).slice(0, offset === 0 || Math.abs(offset) === 1 ? undefined : 3)}</span>
        <span className="font-mono text-[11px] tabular-nums text-muted">{Number(date.slice(8))}</span>
      </button>
      {events.map((event, index) => (
        <div key={event.id} className="contents">
          {place?.row === index && place.inside === null ? <NowLine now={now} /> : null}
          <NowAcross now={now} inside={place?.row === index ? place.inside : null}>
            <EventCard event={event} today={today} past={offset === 0 && over(event, now)} onOpen={onOpen} act={act} />
          </NowAcross>
        </div>
      ))}
      {place && place.row === events.length && events.length > 0 ? <NowLine now={now} /> : null}
    </div>
  );
}

// An event in a day's column: its tick or bell and title, then its time and what it is
function EventCard({ event, today, past, onOpen, act }: { event: CalendarEvent; today: ISODate; past: boolean; onOpen: (event: CalendarEvent) => void; act: Act }) {
  const off = event.kind === "alarm" && !event.alarm.enabled;
  return (
    <div role="group" aria-label={event.title} className={`rounded-lg border-l-[3px] bg-ink/[0.035] px-2 py-1.5 hover:bg-ink/[0.06] ${edgeClass(event, today)} ${off || past ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-1.5">
        {event.kind === "deadline" ? <Tick done={false} onClick={() => void act("completeDeadline", event.id)} /> : <TimeMark event={event} />}
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

export function WeekList({ calendar, today, monday, onWeek, onOpen, onDay, now, act }: CalendarViewProps) {
  const [weeks, setWeeks] = useState(WEEKS_SHOWN);
  return (
    <div className="flex flex-col gap-7">
      {monday === weekStart(today) ? null : (
        <button type="button" onClick={() => onWeek(weekStart(today))} className="self-start rounded-lg border border-ink/12 px-3 py-1.5 text-[12.5px] text-ink/80 hover:bg-ink/6 phone:min-h-11">
          ‹ Back to this week
        </button>
      )}
      {Array.from({ length: weeks }, (_, index) => {
        const first = addDays(monday, 7 * index);
        // Days gone by are left out, unless something is still on them
        const days = Array.from({ length: 7 }, (_, offset) => addDays(first, offset)).filter((date) => date >= today || eventsOn(date, calendar, today).length > 0);
        const busy = days.filter((date) => date === today || eventsOn(date, calendar, today).length > 0);
        const free = days.filter((date) => !busy.includes(date));
        return (
          <section key={first} aria-label={`Week of ${dayLabel(first)}`} className="space-y-5">
            <p className="caps font-['Silkscreen'] text-[11px] text-muted">{weekTitle(first, today)}</p>
            {busy.map((date) => {
              const events = eventsOn(date, calendar, today);
              const place = date === today ? nowAmong(events, now) : null;
              return (
                <div key={date} className="space-y-2">
                  <DayHeader date={date} today={today} onClick={() => onDay(date)} />
                  {events.map((event, index) => (
                    <div key={event.id} className="space-y-2">
                      {place?.row === index && place.inside === null ? <NowLine now={now} /> : null}
                      <NowAcross now={now} inside={place?.row === index ? place.inside : null}>
                        <EventRow event={event} today={today} past={date === today && over(event, now)} onOpen={onOpen} act={act} />
                      </NowAcross>
                    </div>
                  ))}
                  {place && place.row === events.length && events.length > 0 ? <NowLine now={now} /> : null}
                  {events.length ? null : <p className="px-1 py-1 text-[12px] text-muted">Nothing on today.</p>}
                </div>
              );
            })}
            {free.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11.5px] text-muted">
                <span className="mr-1">Free</span>
                {free.map((date) => (
                  <button key={date} type="button" onClick={() => onDay(date)} aria-label={`See ${dayLabel(date)}`} className="min-h-9 rounded-md px-2 font-mono hover:bg-ink/6 hover:text-ink/85">
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

// A day's heading across the list: its name and date over a rule, ember for today; a tap opens the day
function DayHeader({ date, today, onClick }: { date: ISODate; today: ISODate; onClick: () => void }) {
  const isToday = date === today;
  return (
    <button type="button" onClick={onClick} aria-label={`See ${isToday ? "today" : dayLabel(date)}`} className={`flex w-full items-baseline gap-3 border-b pb-1.5 text-left hover:border-ink/30 ${isToday ? "border-ember/50 text-ember" : "border-ink/12 text-ink/85"}`}>
      <span className="font-['Silkscreen'] text-[14px]">{dayName(date, today)}</span>
      <span className="font-mono text-[11.5px] text-muted">{dayLabel(date, { day: "numeric", month: "short" })}</span>
    </button>
  );
}

// An event as a row across the day: a deadline with its tick, an alarm with its bell, the title, and
// under it the time and what it is; a tap on the text opens it
function EventRow({ event, today, past, onOpen, act }: { event: CalendarEvent; today: ISODate; past: boolean; onOpen: (event: CalendarEvent) => void; act: Act }) {
  const off = event.kind === "alarm" && !event.alarm.enabled;
  return (
    <div role="group" aria-label={event.title} className={`flex items-center gap-3 rounded-lg border-l-[3px] bg-ink/[0.03] py-2 pr-3 pl-3 hover:bg-ink/[0.06] ${edgeClass(event, today)} ${off || past ? "opacity-50" : ""}`}>
      {event.kind === "deadline" ? <Tick done={false} onClick={() => void act("completeDeadline", event.id)} /> : <TimeMark event={event} />}
      <button type="button" onClick={() => onOpen(event)} aria-label={`Open ${event.title}`} className="min-h-9 min-w-0 flex-1 text-left">
        <span className="line-clamp-2 text-[13px] leading-snug text-ink/90 [overflow-wrap:anywhere]">{event.title}</span>
        <span className="mt-0.5 block text-[11px] text-muted">{cardDetail(event, today, off)}</span>
      </button>
    </div>
  );
}

// ---- The month ----

// A month's grid, paged; each day a number over a dot per event (up to four). The week in view is
// banded; a tap on a day picks its week. `large` fills the phone's screen.
export function MonthDots({ calendar, today, monday, onWeek, large }: CalendarViewProps & { large?: boolean }) {
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
              const events = eventsOn(date, calendar, today);
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
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted">
        <Legend dot="bg-ember">Deadline</Legend>
        <Legend dot="bg-sky-400">Alarm</Legend>
        <Legend dot="bg-emerald-400">Event</Legend>
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

// What an event is, short: an alarm's or event's time first, a deadline's alarm last
function cardDetail(event: CalendarEvent, today: ISODate, off: boolean) {
  if (event.kind === "alarm") {
    const { kind } = event.alarm;
    return `${showTime(event.time)}${kind === "plain" ? "" : ` · ${kindLabels[kind].toLowerCase()}`}${off ? " · off" : ""}`;
  }
  if (event.kind === "event") {
    const { minutes, rings } = event.event;
    return `${minutes ? `${showTime(event.time)} – ${showTime(clockAfter(event.time, minutes))}` : showTime(event.time)}${rings ? " · rings" : ""}`;
  }
  const days = daysBetween(today, event.date);
  return `${days < 0 ? `${-days}d late` : "Due"}${event.time ? ` · alarm ${showTime(event.time)}` : ""}`;
}

// A bell for an alarm; a clock face for an event
function TimeMark({ event }: { event: CalendarEvent }) {
  if (event.kind === "event") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-px h-4 w-4 shrink-0 text-emerald-300" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 5v3l2 1.5" />
      </svg>
    );
  }
  return <BellMark />;
}

function BellMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-px h-4 w-4 shrink-0 text-sky-300" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3L4 11ZM6.5 14a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

function edgeClass(event: CalendarEvent, today: ISODate) {
  if (event.kind === "event") return "border-emerald-400/70";
  if (event.kind === "alarm") return "border-sky-400/70";
  return event.date < today ? "border-red-400/80" : "border-ember/70";
}

function dotClass(event: CalendarEvent, today: ISODate) {
  if (event.kind === "event") return "bg-emerald-400";
  if (event.kind === "alarm") return !event.alarm.enabled ? "bg-ink/25" : "bg-sky-400";
  return event.date < today ? "bg-red-400" : "bg-ember";
}
