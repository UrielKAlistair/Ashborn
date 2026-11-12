import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popup } from "../components/Popup";
import { Switch } from "../components/Switch";
import { TimeField } from "../components/TimeField";
import { alarmsAvailable } from "../lib/alarms";
import { addDays, atTime, clockOf, showTime, startOfDay, toISODate, week } from "../shared/dates";
import { movedLabel, nextOccurrence, upcomingAlarms, type AlarmInstance } from "../shared/schedule";
import type { Alarm, Snapshot, Weekday } from "../shared/types";
import type { Act } from "./home/HomePage";
import { field, kindLabels } from "./alarmParts";
import { AlarmFields } from "./calendar/EventDialog";

/**
 * The Alarms screen, in two views. Today: everything still to ring today, from every source (the
 * user's alarms, routines, deadlines, meal reminders), each with a switch that skips that one ring.
 * A tap there changes that ring alone: a one-time alarm opens in the Calendar's form
 * (calendar/EventDialog.tsx), which can move it to another day; a ring of a repeating alarm or a
 * routine can be moved to another time that day (MoveRing). Repeating: the user's repeating alarms,
 * each with a switch that turns it off on every day; a tap edits it for every day.
 * A new alarm is set in a pop-up from the round + button: a repeating one, or a one-time one within
 * the next day; one-time alarms further ahead are set on the Calendar.
 * Rings are computed here from the snapshot (shared/schedule.ts), as the phone computes them.
 */

// One-tap alarms, in minutes from now
const QUICK_MINUTES = [10, 30, 60, 120];

// Where a ring comes from, by its key's prefix
const sourceLabels: Record<string, string> = { alarm: "Alarm", routine: "Routine", deadline: "Deadline", meal: "Meal" };

export function AlarmsPage({ snapshot, act }: { snapshot: Snapshot; act: Act }) {
  const [view, setView] = useState<"today" | "all">("today");
  // The alarm open in the pop-up, by id, so it is read from the latest data; one deleted elsewhere closes it
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  // The alarm as the pop-up opened on it, which the form starts from
  const opened = useRef<Alarm | null>(null);
  const editing = editingId === "new" ? "new" : (snapshot.alarms.find((alarm) => alarm.id === editingId) ?? null);
  // The ring of a repeating alarm or a routine being moved, that day only
  const [moving, setMoving] = useState<AlarmInstance | null>(null);

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

  const edit = (alarm: Alarm) => {
    opened.current = alarm;
    setEditingId(alarm.id);
  };

  const toggle = "rounded-lg border border-ink/12 px-3 py-1.5 text-[12.5px] text-ink/80 hover:bg-ink/6 active:bg-ink/10 phone:min-h-11";
  // The panel scrolls inside itself on the desktop. On the phone the screen scrolls instead, and the
  // panel is as tall as its rows (at least the screen): a column that neither shrinks it nor stretches it.
  return (
    <div className="relative mx-auto flex min-h-0 w-full min-w-0 max-w-xl flex-1 phone:max-w-none">
      <div className="panel-scroll flex min-h-0 min-w-0 flex-1 phone:flex-col phone:overflow-y-auto">
        <section className="panel-lift rounded-2xl border border-ink/8 bg-panel panel-scroll flex min-h-0 w-full flex-col gap-5 overflow-y-auto p-5 pb-20 phone:shrink-0 phone:grow phone:overflow-visible">
          <div className="flex items-center justify-between gap-3">
            <h1 className="caps font-display text-[13px] font-bold text-ink/90">{view === "today" ? "Today" : "Repeating"}</h1>
            {view === "today" ? (
              <button type="button" onClick={() => setView("all")} className={toggle}>
                Repeating ›
              </button>
            ) : (
              <button type="button" onClick={() => setView("today")} className={toggle}>
                ‹ Today
              </button>
            )}
          </div>

          {alarmsAvailable ? null : <p className="-mt-3 text-[11.5px] text-muted">They ring on your phone.</p>}

          {view === "today" ? <TodayRings snapshot={snapshot} act={act} onEdit={edit} onMove={setMoving} /> : <AllAlarms alarms={snapshot.alarms} act={act} onEdit={edit} />}
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

      {moving ? (
        <Popup label="Move this ring" onClose={() => setMoving(null)}>
          <MoveRing ring={moving} snapshot={snapshot} act={act} onDone={() => setMoving(null)} />
        </Popup>
      ) : null}

      {editing && editing !== "new" && editing.at ? (
        <Popup label="Edit alarm" onClose={() => setEditingId(null)}>
          <AlarmFields alarm={editing} date={toISODate(new Date(editing.at))} act={act} onDone={() => setEditingId(null)} />
        </Popup>
      ) : editing ? (
        <Popup label={editing === "new" ? "New alarm" : "Edit alarm"} onClose={() => setEditingId(null)}>
          {editing === "new" ? (
            <div className="flex flex-wrap gap-2">
              {QUICK_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => save({ label: "", kind: "plain", sound: "default", at: new Date(Date.now() + minutes * 60_000).toISOString(), time: null, weekdays: [] })}
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
// drops the rings that have passed. A ring switched back on rings at its own time again, so the
// alarm a move made for it goes.
function TodayRings({ snapshot, act, onEdit, onMove }: { snapshot: Snapshot; act: Act; onEdit: (alarm: Alarm) => void; onMove: (ring: AlarmInstance) => void }) {
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
        const alarm = ownAlarm(ring, snapshot);
        const repeating = ring.key.startsWith("routine:") || Boolean(alarm?.time);
        const onOpen = repeating ? () => onMove(ring) : alarm ? () => onEdit(alarm) : undefined;
        return (
          <Row key={ring.key} time={clockOf(ring.at)} title={ring.title} detail={detailOf(ring, snapshot)} dim={!on} onOpen={onOpen}>
            <Switch
              label={`${ring.title} rings today`}
              on={on}
              onChange={(rings) => {
                void act("setAlarmSkip", ring.key, toISODate(ring.at), !rings);
                if (rings) for (const moved of movedCopies(ring, snapshot)) void act("deleteAlarm", moved.id);
              }}
            />
          </Row>
        );
      })}
    </RowList>
  );
}

// The user's repeating alarms, by time of day: the switch turns a whole alarm off, every day it repeats on
function AllAlarms({ alarms: all, act, onEdit }: { alarms: Alarm[]; act: Act; onEdit: (alarm: Alarm) => void }) {
  const alarms = all.filter((alarm) => alarm.time);
  if (alarms.length === 0) return <p className="rounded-xl bg-ink/[0.02] px-3 py-2.5 text-[12px] text-muted">None set. One-time alarms are on the Calendar; routines, deadlines and meals ring from their own settings.</p>;
  return (
    <RowList>
      {[...alarms].sort((a, b) => a.time!.localeCompare(b.time!)).map((alarm) => {
        const stops = alarm.kind === "plain" ? "" : kindLabels[alarm.kind].toLowerCase();
        return (
          <Row key={alarm.id} time={alarm.time!} title={alarm.label || "Alarm"} detail="" days={{ weekdays: alarm.weekdays, stops }} dim={!alarm.enabled} onOpen={() => onEdit(alarm)}>
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
// week, then how it stops, in place of `detail`. The time (HH:MM) shows on a 12-hour clock in
// Silkscreen, a square pixel face.
function Row({ time, title, detail, days, dim, onOpen, children }: { time: string; title: string; detail: string; days?: { weekdays: Weekday[]; stops: string }; dim: boolean; onOpen?: () => void; children: ReactNode }) {
  const [clock, half] = showTime(time).split(" ");
  const content = (
    <>
      <span className="flex shrink-0 items-baseline gap-1 leading-none text-ember font-['Silkscreen']">
        <span className="w-[5.2ch] text-right tabular-nums text-[27px]">{clock}</span>
        <span className="w-[2ch] text-[11px]">{half}</span>
      </span>
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

// Moves one ring of a repeating alarm or a routine to another time on its day: the ring is skipped
// and a one-off alarm named for it (movedLabel) rings instead, replacing any an earlier move made
function MoveRing({ ring, snapshot, act, onDone }: { ring: AlarmInstance; snapshot: Snapshot; act: Act; onDone: () => void }) {
  const was = clockOf(ring.at);
  const day = toISODate(ring.at);
  const [time, setTime] = useState(was);
  const at = time ? atTime(day, time) : null;
  const passed = at !== null && at.getTime() <= Date.now();

  const move = () => {
    if (!at || passed) return;
    for (const moved of movedCopies(ring, snapshot)) void act("deleteAlarm", moved.id);
    void act("setAlarmSkip", ring.key, day, true);
    void act("createAlarm", { id: crypto.randomUUID(), label: movedLabel(ring.title, was), kind: ring.kind, sound: ring.sound, at: at.toISOString(), time: null, weekdays: [], enabled: true });
    onDone();
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink/85">{ring.title}</p>
      <p className="text-[11.5px] text-muted">Today only: it rings at {was} on its other days.</p>
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

// A ring's source, and for the user's own alarms how it stops
function detailOf(ring: AlarmInstance, snapshot: Snapshot) {
  const source = ring.key.split(":")[0];
  const alarm = ownAlarm(ring, snapshot);
  const stops = alarm && alarm.kind !== "plain" ? ` · ${kindLabels[alarm.kind].toLowerCase()}` : "";
  return `${sourceLabels[source] ?? "Alarm"}${stops}`;
}

// A time, days (none: once, at the next such time), a label and how it stops; filled from `alarm`
// when editing a repeating one
function AlarmForm({ alarm, onSave }: { alarm: Alarm | null; onSave: (alarm: Omit<Alarm, "id" | "enabled">) => unknown }) {
  const [time, setTime] = useState(alarm?.time ?? "07:00");
  const [days, setDays] = useState<Weekday[]>(alarm?.weekdays ?? []);
  const [label, setLabel] = useState(alarm?.label ?? "");
  const [kind, setKind] = useState<Alarm["kind"]>(alarm?.kind ?? "plain");

  const submit = () => {
    if (!time) return;
    const at = days.length === 0 ? nextOccurrence(time).toISOString() : null;
    onSave({ label: label.trim(), kind, sound: alarm?.sound ?? "default", at, time: at ? null : time, weekdays: days });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <TimeField label="Time" value={time} onChange={setTime} className={`${field} w-36 text-base`} />
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
