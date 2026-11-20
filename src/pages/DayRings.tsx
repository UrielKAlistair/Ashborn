import { useEffect, useRef, useState, type ReactNode } from "react";
import { Switch } from "../components/Switch";
import { TimeField } from "../components/TimeField";
import { useNow } from "../lib/useNow";
import { addDays, atTime, clockAfter, clockOf, daysBetween, showTime, startOfDay, toISODate, week } from "../shared/dates";
import { eventsOn, movedLabel, upcomingAlarms, type AlarmInstance, type DayEvent } from "../shared/schedule";
import type { Alarm, Deadline, ISODate, Snapshot, Weekday } from "../shared/types";
import { field, kindLabels } from "./alarmParts";
import { canHover } from "./home/graphLayout";
import { Tick } from "./home/Tick";
import type { Act } from "./home/HomePage";

/**
 * One day's schedule: the times on it, in order, whether they ring or not. The rings come from every
 * source (the user's alarms, routines, deadlines' alarms, meal reminders); the events are the user's
 * times that don't ring (a test from 11 to 1), with how long they last. The deadlines due that day,
 * which have no time, sit above. The Alarms screen's day and the Calendar's day are this one view.
 * Each ring still to come shows how long until it rings and a switch that skips that ring alone; an
 * event shows how long until it starts, and is lit while it is on. On today a blue line marks now,
 * and what is over is greyed. Taps are reported up: a one-time alarm or event or a deadline to open,
 * a repeating event to edit, a ring of a repeating alarm or a routine to move (MoveRing).
 * Rings are computed from the snapshot (shared/schedule.ts), as the phone computes them.
 */

type DayRingsProps = {
  snapshot: Snapshot;
  date: ISODate;
  act: Act;
  onOpenAlarm: (alarm: Alarm) => void;
  onOpenDeadline: (deadline: Deadline) => void;
  onMove: (ring: AlarmInstance) => void;
};

type Entry = { type: "ring"; at: Date; ring: AlarmInstance } | { type: "event"; at: Date; event: DayEvent };

export function DayRings({ snapshot, date, act, onOpenAlarm, onOpenDeadline, onMove }: DayRingsProps) {
  const now = useNow();
  const today = toISODate(now);
  const start = startOfDay(date);
  const end = startOfDay(addDays(date, 1));
  const skipped = new Set(snapshot.skippedAlarms.map((skip) => skip.key));
  // From just before midnight, so a ring at 00:00 is the day's; that moment is on the day before, so two days are read
  const rings = upcomingAlarms({ ...snapshot, skippedAlarms: [] }, new Date(start.getTime() - 1), 2)
    .filter((ring) => ring.at >= start && ring.at < end)
    // A ring moved to another time shows once, at its new time
    .filter((ring) => skipped.has(ring.key) === false || movedCopies(ring, snapshot).length === 0);
  const entries: Entry[] = [...rings.map((ring) => ({ type: "ring" as const, at: ring.at, ring })), ...eventsOn(snapshot, date).map((event) => ({ type: "event" as const, at: event.at, event }))].sort((a, b) => a.at.getTime() - b.at.getTime());
  // An overdue deadline stays on today until it is ticked or deleted
  const deadlines = snapshot.deadlines.filter((deadline) => deadline.dueDate === date || (date === today && deadline.dueDate < today));
  // Now sits before the first time still to come; an event already on stays above it
  const nowAt = date === today ? entries.findIndex((entry) => entry.at > now) : -1;

  if (entries.length === 0 && deadlines.length === 0) return <p className="rounded-xl bg-ink/[0.02] px-3 py-2.5 text-[12px] text-muted">Nothing on this day.</p>;
  return (
    <RowList>
      {deadlines.map((deadline) => (
        <DeadlineRow key={deadline.id} deadline={deadline} today={today} act={act} onOpen={() => onOpenDeadline(deadline)} />
      ))}
      {entries.map((entry, index) => (
        <div key={entry.type === "ring" ? entry.ring.key : entry.event.key} className="space-y-2.5">
          {index === nowAt ? <NowLine now={now} /> : null}
          {entry.type === "event" ? (
            <EventRow event={entry.event} now={now} onOpen={() => onOpenAlarm(entry.event.alarm)} />
          ) : (
            <RingRow ring={entry.ring} on={!skipped.has(entry.ring.key)} snapshot={snapshot} now={now} act={act} onOpenAlarm={onOpenAlarm} onMove={onMove} />
          )}
        </div>
      ))}
      {date === today && entries.length > 0 && nowAt === -1 ? <NowLine now={now} /> : null}
    </RowList>
  );
}

// One ring of the day, with the switch that skips it alone
function RingRow({ ring, on, snapshot, now, act, onOpenAlarm, onMove }: { ring: AlarmInstance; on: boolean; snapshot: Snapshot; now: Date; act: Act; onOpenAlarm: (alarm: Alarm) => void; onMove: (ring: AlarmInstance) => void }) {
  const passed = ring.at <= now;
  const alarm = ownAlarm(ring, snapshot);
  const moved = /^(.*) \(moved from (.+)\)$/s.exec(ring.title);
  const repeating = ring.key.startsWith("routine:") || Boolean(alarm?.time);
  const onOpen = passed ? undefined : repeating ? () => onMove(ring) : alarm ? () => onOpenAlarm(alarm) : undefined;
  return (
    <Row time={clockOf(ring.at)} title={moved ? moved[1] : ring.title} detail={moved ? `Moved from ${moved[2]}` : detailOf(ring, snapshot)} until={passed || !on ? undefined : ringsIn(ring.at, now)} dim={passed || !on} onOpen={onOpen}>
      {passed ? null : (
        <Switch
          label={`${ring.title} rings on ${toISODate(ring.at)}`}
          on={on}
          onChange={(rings) => {
            void act("setAlarmSkip", ring.key, toISODate(ring.at), !rings);
            if (rings) for (const moved of movedCopies(ring, snapshot)) void act("deleteAlarm", moved.id);
          }}
        />
      )}
    </Row>
  );
}

// One event of the day: its start, how long until it starts (or that it is on), its span; lit while on
function EventRow({ event, now, onOpen }: { event: DayEvent; now: Date; onOpen: () => void }) {
  const ends = new Date(event.at.getTime() + (event.minutes ?? 0) * 60_000);
  const on = event.at <= now && now < ends;
  const over = !on && ends <= now;
  const start = clockOf(event.at);
  const span = event.minutes ? `${showTime(start)} – ${showTime(clockAfter(start, event.minutes))} · ${lasts(event.minutes)}` : showTime(start);
  return (
    <Row
      time={start}
      tone="event"
      lit={on}
      title={event.title}
      detail={`${event.alarm.time ? "Every " + daysText(event.alarm.weekdays) : "Event"} · ${span}`}
      until={on ? "on now" : over ? undefined : ringsIn(event.at, now)}
      dim={over}
      onOpen={onOpen}
    >
      {null}
    </Row>
  );
}

// How long an event lasts: "45 min", "2h", "1h 30m"
function lasts(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

// The weekdays a repeating event is on, short: "day" for all seven, else "Mon, Wed"
function daysText(weekdays: Weekday[]) {
  return weekdays.length === 7 ? "day" : week.filter((day) => weekdays.includes(day)).join(", ");
}

// How long until a ring, short enough to sit under its time: "in 45 min", "in 3h 20m", and past two
// days "in 3d 4h"
export function ringsIn(at: Date, now: Date) {
  const minutes = Math.ceil((at.getTime() - now.getTime()) / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `in ${Math.floor(hours / 24)}d${hours % 24 ? ` ${hours % 24}h` : ""}`;
}

// The current time, as a blue rule across the list
export function NowLine({ now }: { now: Date }) {
  return (
    <div role="separator" aria-label="Now" className="flex items-center gap-2 py-1 font-['Silkscreen'] whitespace-nowrap text-sky-400">
      <span className="h-0.5 min-w-2 flex-1 rounded-full bg-sky-400" />
      <span className="text-[12px] tracking-wider">NOW</span>
      <span className="text-[11px] tabular-nums">{showTime(clockOf(now))}</span>
      <span className="h-0.5 flex-1 rounded-full bg-sky-400" />
    </div>
  );
}

// Text cut to two lines with an ellipsis. Where a pointer can hover, resting on it a moment lifts the cut
// and scrolls the rest up through the same two lines, at SCROLL_PX_PER_S; leaving puts it back.
const SCROLL_PX_PER_S = 18;
const HOVER_DELAY_MS = 600;
function ClampedText({ text, className }: { text: string; className: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!open || !box.current || !inner.current) return;
    setShift(Math.max(0, inner.current.offsetHeight - box.current.clientHeight));
  }, [open]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const enter = () => {
    if (!canHover) return;
    timer.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setShift(0);
  };
  return (
    <span ref={box} onMouseEnter={enter} onMouseLeave={leave} className={`block max-h-10 overflow-hidden ${className}`}>
      <span
        ref={inner}
        className={`whitespace-pre-line [overflow-wrap:anywhere] ${open ? "block" : "line-clamp-2"}`}
        style={shift ? { transform: `translateY(-${shift}px)`, transition: `transform ${shift / SCROLL_PX_PER_S}s linear 0.3s` } : undefined}
      >
        {text}
      </span>
    </span>
  );
}

// The rows' column
export function RowList({ children }: { children: ReactNode }) {
  return <div className="space-y-2.5">{children}</div>;
}

// A ring, an alarm or an event: its time (and how long until it) and what it is, then its switch. With
// `onOpen`, the time and text are a button that opens it. `detail` sits under the title. The time
// (HH:MM) shows on a 12-hour clock in Silkscreen, a square pixel face: ember for a ring, green for an
// event, which is `lit` while it is on.
export function Row({ time, title, detail, until, dim, tone = "ring", lit = false, onOpen, children }: { time: string; title: string; detail: ReactNode; until?: string; dim: boolean; tone?: "ring" | "event"; lit?: boolean; onOpen?: () => void; children: ReactNode }) {
  const ink = tone === "event" ? "text-emerald-300" : "text-ember";
  const [clock, half] = showTime(time).split(" ");
  const content = (
    <>
      {/* Wide enough for "12:45 PM" (97 px of clock in Silkscreen at 30 px, then the half); the time to
          the ring sits centred under the clock's digits */}
      <span className="flex w-[128px] shrink-0 justify-end">
        <span className="grid grid-cols-[auto_22px] items-baseline gap-x-1 gap-y-2.5 leading-none font-['Silkscreen']">
          <span className={`text-right tabular-nums text-[30px] ${ink}`}>{clock}</span>
          <span className={`text-[12px] ${ink}`}>{half}</span>
          {until ? <span className={`justify-self-center whitespace-nowrap text-[10px] tabular-nums ${lit ? "text-emerald-300" : "text-sky-400"}`}>{until}</span> : null}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <ClampedText text={title} className="text-[14px] leading-5 text-ink/90" />
        <span className="mt-1 block text-[12px] text-muted">{detail}</span>
      </span>
    </>
  );
  // An event's wider left edge comes out of its padding, so its clock lines up with the rings'
  return (
    <div role="group" aria-label={title} className={`alarm-card flex items-center gap-4 rounded-xl border py-4 pr-4 hover:border-ink/25 ${tone === "event" ? "border-l-[3px] border-ink/12 border-l-emerald-400/70 pl-[14px]" : "border-ink/12 pl-4"} ${lit ? "bg-emerald-400/[0.07]" : "bg-card"} ${dim ? "opacity-50" : ""}`}>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={`Edit ${title}`} className="flex min-w-0 flex-1 items-center gap-4 text-left">
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-4">{content}</div>
      )}
      {children}
    </div>
  );
}

// A deadline due on the day: its tick, title and how late it is; a tap on the text opens it
function DeadlineRow({ deadline, today, act, onOpen }: { deadline: Deadline; today: ISODate; act: Act; onOpen: () => void }) {
  const late = daysBetween(deadline.dueDate, today);
  return (
    <div role="group" aria-label={deadline.title} className={`flex items-center gap-3 rounded-xl border border-l-[3px] border-ink/12 bg-card px-4 py-3.5 hover:border-ink/25 ${late > 0 ? "border-l-red-400/80" : "border-l-ember/70"}`}>
      <Tick done={false} onClick={() => void act("completeDeadline", deadline.id)} />
      <button type="button" onClick={onOpen} aria-label={`Open ${deadline.title}`} className="min-w-0 flex-1 text-left phone:min-h-9">
        <span className="block text-[14px] text-ink/90 [overflow-wrap:anywhere]">{deadline.title}</span>
        <span className="mt-1 block text-[12px] text-muted">
          {late > 0 ? `Deadline · ${late}d late` : "Deadline"}
          {deadline.alarmTime ? ` · alarm ${showTime(deadline.alarmTime)}` : ""}
        </span>
      </button>
    </div>
  );
}

// Moves one ring of a repeating alarm or a routine to another time on its day: the ring is skipped
// and a one-off alarm named for it (movedLabel) rings instead, replacing any an earlier move made
export function MoveRing({ ring, snapshot, act, onDone }: { ring: AlarmInstance; snapshot: Snapshot; act: Act; onDone: () => void }) {
  const was = clockOf(ring.at);
  const day = toISODate(ring.at);
  const [time, setTime] = useState(was);
  const at = time ? atTime(day, time) : null;
  const passed = at !== null && at.getTime() <= Date.now();

  const move = () => {
    if (!at || passed) return;
    for (const moved of movedCopies(ring, snapshot)) void act("deleteAlarm", moved.id);
    void act("setAlarmSkip", ring.key, day, true);
    void act("createAlarm", { id: crypto.randomUUID(), label: movedLabel(ring.title, was), kind: ring.kind, sound: ring.sound, at: at.toISOString(), time: null, weekdays: [], enabled: true, minutes: null });
    onDone();
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink/85">{ring.title}</p>
      <p className="text-[11.5px] text-muted">This day only: it rings at {showTime(was)} on its other days.</p>
      <div className="flex items-center gap-3">
        <TimeField label="Ring at" value={time} onChange={setTime} className={`${field} w-36 text-base`} />
        <button type="button" onClick={move} disabled={!at || passed || time === was} className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50 phone:min-h-11">
          Move
        </button>
      </div>
      {passed ? <p className="text-[11.5px] text-muted">That time has passed.</p> : null}
    </div>
  );
}

// The one-off alarms moves of `ring` made, on its day
function movedCopies(ring: AlarmInstance, snapshot: Snapshot) {
  const label = movedLabel(ring.title, clockOf(ring.at));
  return snapshot.alarms.filter((alarm) => alarm.at && alarm.label === label && toISODate(new Date(alarm.at)) === toISODate(ring.at));
}

// The user's own alarm a ring comes from, if it comes from one
function ownAlarm(ring: AlarmInstance, snapshot: Snapshot) {
  const [source, rest] = ring.key.split(":");
  return source === "alarm" ? snapshot.alarms.find((candidate) => candidate.id === rest.split("@")[0]) : undefined;
}

// Where a ring comes from, by its key's prefix
const sourceLabels: Record<string, string> = { alarm: "Alarm", routine: "Routine", deadline: "Deadline", meal: "Meal" };

// A ring's source, and for the user's own alarms how it stops
function detailOf(ring: AlarmInstance, snapshot: Snapshot) {
  const source = ring.key.split(":")[0];
  const alarm = ownAlarm(ring, snapshot);
  const stops = alarm && alarm.kind !== "plain" ? ` · ${kindLabels[alarm.kind].toLowerCase()}` : "";
  return `${sourceLabels[source] ?? "Alarm"}${stops}`;
}
