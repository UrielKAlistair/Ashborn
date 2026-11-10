import { useEffect, useRef, useState, type ReactNode } from "react";
import { alarmsAvailable } from "../lib/alarms";
import { SITUPS_TO_STOP, STEPS_TO_STOP } from "../lib/motion";
import { addDays, clockOf, startOfDay, toISODate, week } from "../shared/dates";
import { nextOccurrence, upcomingAlarms, type AlarmInstance } from "../shared/schedule";
import type { Alarm, Snapshot, Weekday } from "../shared/types";
import type { Act } from "./home/HomePage";

/**
 * The Alarms screen, in two views. Today: everything still to ring today, from every source (the
 * user's alarms, routines, deadlines, meal reminders), each with a switch that skips that one ring.
 * All alarms: the user's own alarms, each with a switch that turns it off on every day; a tap opens
 * it to edit or delete. A new alarm is set in a pop-up from the round + button.
 * Rings are computed here from the snapshot (shared/schedule.ts), as the phone computes them.
 */

// One-tap alarms, in minutes from now
const QUICK_MINUTES = [10, 30, 60, 120];

const kindLabels: Record<Alarm["kind"], string> = {
  plain: "Plain",
  walk: `Walk ${STEPS_TO_STOP} steps`,
  situps: `${SITUPS_TO_STOP} sit-ups`,
};

// Where a ring comes from, by its key's prefix
const sourceLabels: Record<string, string> = { alarm: "Alarm", routine: "Routine", deadline: "Deadline", meal: "Meal" };

export function AlarmsPage({ snapshot, act }: { snapshot: Snapshot; act: Act }) {
  const [view, setView] = useState<"today" | "all">("today");
  // The alarm open in the pop-up, by id, so it is read from the latest data; one deleted elsewhere closes it
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  // The alarm as the pop-up opened on it, which the form starts from
  const opened = useRef<Alarm | null>(null);
  const editing = editingId === "new" ? "new" : (snapshot.alarms.find((alarm) => alarm.id === editingId) ?? null);

  const save = (alarm: Omit<Alarm, "id" | "enabled">) => {
    if (editing === "new") void act("createAlarm", { ...alarm, id: crypto.randomUUID(), enabled: true });
    else if (editing) {
      // Only what was changed since the form opened: each field sent is stamped as changed now, so one sent
      // as it was would win over a change made to it meanwhile on another device
      const changed = Object.fromEntries(Object.entries(alarm).filter(([field, value]) => JSON.stringify(value) !== JSON.stringify(opened.current?.[field as keyof Alarm])));
      if (Object.keys(changed).length > 0) void act("updateAlarm", editing.id, changed);
    }
    setEditingId(null);
  };

  const toggle = "rounded-lg border border-ink/12 px-3 py-1.5 text-[12.5px] text-ink/80 hover:bg-ink/6 active:bg-ink/10 phone:min-h-11";
  // The panel scrolls inside itself on the desktop. On the phone the screen scrolls instead, and the
  // panel is as tall as its rows (at least the screen): a column that neither shrinks it nor stretches it.
  return (
    <div className="relative mx-auto flex min-h-0 w-full min-w-0 max-w-xl flex-1 phone:max-w-none">
      <div className="panel-scroll flex min-h-0 min-w-0 flex-1 phone:flex-col phone:overflow-y-auto">
        <section className="panel-lift rounded-2xl border border-ink/8 bg-panel panel-scroll flex min-h-0 w-full flex-col gap-5 overflow-y-auto p-5 pb-20 phone:shrink-0 phone:grow phone:overflow-visible">
          <div className="flex items-center justify-between gap-3">
            <h1 className="caps font-display text-[13px] font-bold text-ink/90">{view === "today" ? "Today" : "All alarms"}</h1>
            {view === "today" ? (
              <button type="button" onClick={() => setView("all")} className={toggle}>
                All alarms ›
              </button>
            ) : (
              <button type="button" onClick={() => setView("today")} className={toggle}>
                ‹ Today
              </button>
            )}
          </div>

          {alarmsAvailable ? null : <p className="-mt-3 text-[11.5px] text-muted">They ring on your phone.</p>}

          {view === "today" ? <TodayRings snapshot={snapshot} act={act} /> : <AllAlarms alarms={snapshot.alarms} act={act} onEdit={(alarm) => {
                opened.current = alarm;
                setEditingId(alarm.id);
              }} />}
        </section>
      </div>

      <button
        type="button"
        onClick={() => setEditingId("new")}
        aria-label="New alarm"
        className="absolute right-4 bottom-4 flex h-14 w-14 items-center justify-center rounded-full bg-ember text-3xl leading-none text-canvas shadow-[var(--card-shadow)] hover:brightness-110"
      >
        +
      </button>

      {editing ? (
        <Popup label={editing === "new" ? "New alarm" : "Edit alarm"} onClose={() => setEditingId(null)}>
          {editing === "new" ? (
            <div className="flex flex-wrap gap-2">
              {QUICK_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => save({ label: "", kind: "plain", at: new Date(Date.now() + minutes * 60_000).toISOString(), time: null, weekdays: [] })}
                  className="rounded-lg border border-ink/12 px-3.5 py-1.5 text-[13px] text-ink/80 hover:bg-ink/6 active:bg-ink/10 phone:min-h-11"
                >
                  In {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
                </button>
              ))}
            </div>
          ) : null}
          <AlarmForm alarm={editing === "new" ? null : editing} onSave={save} />
          {editing === "new" ? null : (
            <button
              type="button"
              onClick={() => {
                void act("deleteAlarm", editing.id);
                setEditingId(null);
              }}
              className="text-[12.5px] text-muted hover:text-red-300 phone:min-h-11"
            >
              Delete this alarm
            </button>
          )}
        </Popup>
      ) : null}
    </div>
  );
}

// What rings before midnight, skipped rings included (switched off), soonest first. Two days are
// asked for, since a routine belongs to the app's day, which can start after midnight; each minute
// drops the rings that have passed.
function TodayRings({ snapshot, act }: { snapshot: Snapshot; act: Act }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const midnight = startOfDay(addDays(toISODate(now), 1), 0);
  const rings = upcomingAlarms({ ...snapshot, skippedAlarms: [] }, now, 2).filter((ring) => ring.at < midnight);
  const skipped = new Set(snapshot.skippedAlarms.map((skip) => skip.key));

  if (rings.length === 0) return <p className="rounded-xl bg-ink/[0.02] px-3 py-2.5 text-[12px] text-muted">Nothing rings for the rest of today.</p>;
  return (
    <RowList>
      {rings.map((ring) => {
        const on = !skipped.has(ring.key);
        return (
          <Row key={ring.key} time={clockOf(ring.at)} title={ring.title} detail={detailOf(ring, snapshot)} dim={!on}>
            <Switch label={`${ring.title} rings today`} on={on} onChange={(rings) => void act("setAlarmSkip", ring.key, toISODate(ring.at), !rings)} />
          </Row>
        );
      })}
    </RowList>
  );
}

// The user's own alarms: the switch turns a whole alarm off, every day it repeats on. A one-off that has
// rung is gone from here, though the snapshot keeps it a day for its snooze.
function AllAlarms({ alarms: all, act, onEdit }: { alarms: Alarm[]; act: Act; onEdit: (alarm: Alarm) => void }) {
  const alarms = all.filter((alarm) => !alarm.at || Date.parse(alarm.at) > Date.now());
  if (alarms.length === 0) return <p className="rounded-xl bg-ink/[0.02] px-3 py-2.5 text-[12px] text-muted">None set. Routines, deadlines and meals ring from their own settings.</p>;
  return (
    <RowList>
      {[...alarms].sort(bySchedule).map((alarm) => {
        const stops = alarm.kind === "plain" ? "" : kindLabels[alarm.kind].toLowerCase();
        const when = alarm.at ? `once, ${day(new Date(alarm.at))}` : daysText(alarm.weekdays);
        return (
          <Row
            key={alarm.id}
            time={alarm.time ?? clockOf(new Date(alarm.at!))}
            title={alarm.label || "Alarm"}
            detail={[when, stops].filter(Boolean).join(" · ")}
            days={alarm.at ? undefined : { weekdays: alarm.weekdays, stops }}
            dim={!alarm.enabled}
            onOpen={() => onEdit(alarm)}
          >
            <Switch label={`${alarm.label || "Alarm"} on`} on={alarm.enabled} onChange={(enabled) => void act("updateAlarm", alarm.id, { enabled })} />
          </Row>
        );
      })}
    </RowList>
  );
}

// The rows' column
function RowList({ children }: { children: ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}

// A ring or an alarm: its time and what it is, then its switch. With `onOpen`, the time and text
// are a button that opens it. With `days` (a repeating alarm) it shows the days as a strip of the
// week, then how it stops, in place of `detail`. The time is in Silkscreen, a square pixel face.
function Row({ time, title, detail, days, dim, onOpen, children }: { time: string; title: string; detail: string; days?: { weekdays: Weekday[]; stops: string }; dim: boolean; onOpen?: () => void; children: ReactNode }) {
  const content = (
    <>
      <span className="w-[5.2ch] shrink-0 leading-none tabular-nums text-ember font-['Silkscreen'] text-[27px]">{time}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-ink/85 [overflow-wrap:anywhere]">{title}</span>
        {days ? (
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <WeekStrip weekdays={days.weekdays} />
            {days.stops ? <span className="text-[11.5px] text-muted">{days.stops}</span> : null}
          </span>
        ) : (
          <span className="mt-0.5 block text-[11.5px] text-muted">{detail}</span>
        )}
      </span>
    </>
  );
  return (
    <div role="group" aria-label={title} className={`alarm-card flex items-center gap-4 rounded-xl border border-ink/12 bg-card px-4 py-2 hover:border-ink/25 ${dim ? "opacity-50" : ""}`}>
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

// A ring's source, and for the user's own alarms how it stops
function detailOf(ring: AlarmInstance, snapshot: Snapshot) {
  const [source, rest] = ring.key.split(":");
  const alarm = source === "alarm" ? snapshot.alarms.find((candidate) => candidate.id === rest.split("@")[0]) : undefined;
  const stops = alarm && alarm.kind !== "plain" ? ` · ${kindLabels[alarm.kind].toLowerCase()}` : "";
  return `${sourceLabels[source] ?? "Alarm"}${stops}`;
}

// Over the page, closed by Escape or a click outside it. Escape is heard in the capture phase and marked
// handled, so the navbar's Escape (which hides the desktop window) leaves it alone.
function Popup({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-2xl border border-ink/10 bg-card p-5 shadow-[var(--card-shadow)]">
        <div className="flex items-center justify-between">
          <p className="caps font-display text-[13px] font-bold text-ink/90">{label}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-muted hover:bg-ink/8 phone:h-11 phone:w-11">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// A time, days (none: once, at the next such time), a label and how it stops; filled from `alarm`
// when editing one
function AlarmForm({ alarm, onSave }: { alarm: Alarm | null; onSave: (alarm: Omit<Alarm, "id" | "enabled">) => unknown }) {
  const [time, setTime] = useState(alarm ? (alarm.time ?? clockOf(new Date(alarm.at!))) : "07:00");
  const [days, setDays] = useState<Weekday[]>(alarm?.weekdays ?? []);
  const [label, setLabel] = useState(alarm?.label ?? "");
  const [kind, setKind] = useState<Alarm["kind"]>(alarm?.kind ?? "plain");

  const submit = () => {
    if (!time) return;
    // A one-off whose time is left as it was keeps its moment: it may be days ahead, and its ring's key
    // (which a skip or snooze holds) is that moment
    const kept = alarm?.at && alarm.weekdays.length === 0 && clockOf(new Date(alarm.at)) === time ? alarm.at : null;
    const at = days.length === 0 ? (kept ?? nextOccurrence(time).toISOString()) : null;
    onSave({ label: label.trim(), kind, at, time: at ? null : time, weekdays: days });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input type="time" aria-label="Time" value={time} onChange={(event) => setTime(event.target.value)} className={`${field} w-28 font-mono text-base tabular-nums`} />
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label (optional)" aria-label="Label" className={`${field} min-w-0 flex-1`} />
      </div>
      <div className="flex gap-1">
        {week.map((weekday) => (
          <button
            key={weekday}
            type="button"
            aria-pressed={days.includes(weekday)}
            aria-label={weekday}
            onClick={() => setDays((current) => (current.includes(weekday) ? current.filter((d) => d !== weekday) : [...current, weekday]))}
            className={`flex-1 rounded-md border py-1.5 text-[11.5px] phone:min-h-11 ${days.includes(weekday) ? "border-ember/50 bg-ember/15 text-ember" : "border-ink/10 text-muted hover:bg-ink/6"}`}
          >
            {weekday.slice(0, 2)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <select value={kind} aria-label="How it stops" onChange={(event) => setKind(event.target.value as Alarm["kind"])} className={`${field} flex-1`}>
          {(Object.keys(kindLabels) as Alarm["kind"][]).map((option) => (
            <option key={option} value={option}>
              {kindLabels[option]}
            </option>
          ))}
        </select>
        <button type="button" onClick={submit} disabled={!time} className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50 phone:min-h-11">
          {alarm ? "Save" : days.length === 0 ? "Set once" : "Set"}
        </button>
      </div>
    </div>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${on ? "border-transparent bg-ember" : "border-ink/15 bg-ink/[0.04]"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] ${on ? "left-[22px] bg-canvas" : "left-0.5 bg-ink/70"}`} />
    </button>
  );
}

// Recurring alarms by time of day, then one-offs by when they ring
function bySchedule(a: Alarm, b: Alarm) {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.at && b.at) return a.at.localeCompare(b.at);
  return a.time ? -1 : 1;
}

// The week's seven initials, the alarm's days inked and marked beneath, the rest faint
function WeekStrip({ weekdays }: { weekdays: Weekday[] }) {
  return (
    <span className="flex gap-1 font-mono text-[11px]" aria-label={daysText(weekdays)}>
      {week.map((weekday) => {
        const on = weekdays.includes(weekday);
        return (
          <span key={weekday} aria-hidden className={`w-[1.4ch] border-b-2 text-center leading-4 ${on ? "border-ember/70 font-semibold text-ink/85" : "border-transparent text-ink/25"}`}>
            {weekday[0]}
          </span>
        );
      })}
    </span>
  );
}

function daysText(days: Weekday[]) {
  if (days.length === 7) return "every day";
  return week.filter((weekday) => days.includes(weekday)).join(" ");
}

const day = (date: Date) => date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

const field =
  "rounded-lg border border-ink/10 bg-canvas/60 px-3 py-1.5 text-[13px] text-ink/90 placeholder:text-ink/35 focus:border-ember/60 focus:outline-none phone:min-h-11";
