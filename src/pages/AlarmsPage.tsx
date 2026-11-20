import { useMemo, useRef, useState } from "react";
import { Popup } from "../components/Popup";
import { Switch } from "../components/Switch";
import { TimeField } from "../components/TimeField";
import { alarmsAvailable } from "../lib/alarms";
import { useToday } from "../lib/useToday";
import { addDays, clockAfter, minutesFrom, week } from "../shared/dates";
import { buildGraphModel } from "../shared/graphModel";
import { nextOccurrence, type AlarmInstance } from "../shared/schedule";
import type { Alarm, ISODate, Snapshot, Weekday } from "../shared/types";
import type { Act } from "./home/HomePage";
import { field, kindLabels } from "./alarmParts";
import { EventDialog, type Editing } from "./calendar/EventDialog";
import { DayRings, MoveRing, Row, RowList } from "./DayRings";

/**
 * The Alarms screen, in two views. The day: today's or tomorrow's schedule, rings, events and
 * deadlines (DayRings, the same view as a day of the Calendar), each ring with a switch that skips it
 * alone; a tap changes that one alone: a one-time alarm or event or a deadline opens in the Calendar's
 * form (calendar/EventDialog.tsx), a ring of a repeating alarm or a routine can be moved to another
 * time that day (MoveRing), a repeating event opens for every day.
 * Repeating: the user's repeating alarms, each with a switch that turns it off on every day; a tap
 * edits it for every day.
 * The round + adds to the day shown, in the Calendar's pop-up: an event, an alarm (one-tap ones for
 * soon among them) or a deadline; on the repeating view it adds a repeating alarm or event.
 */

export function AlarmsPage({ snapshot, act }: { snapshot: Snapshot; act: Act }) {
  const today = useToday();
  const [view, setView] = useState<"day" | "all">("day");
  // The day shown: today, or tomorrow
  const [ahead, setAhead] = useState(0);
  const date: ISODate = addDays(today, ahead);
  // A one-time alarm or a deadline open in the Calendar's pop-up
  const [opening, setOpening] = useState<Editing | null>(null);
  // The quests a deadline can be linked to; read only while the pop-up is open
  const model = useMemo(() => buildGraphModel(snapshot), [snapshot.nodes, snapshot.edges]);
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

  const toggle = "shrink-0 whitespace-nowrap rounded-lg border border-ink/12 px-3 py-1.5 font-['Silkscreen'] text-[11px] uppercase text-ink/80 hover:bg-ink/6 active:bg-ink/10 phone:min-h-11";
  // The panel scrolls inside itself on the desktop. On the phone the screen scrolls instead, and the
  // panel is as tall as its rows (at least the screen): a column that neither shrinks it nor stretches it.
  return (
    <div className="relative mx-auto flex min-h-0 w-full min-w-0 max-w-xl flex-1 phone:max-w-none">
      <div className="panel-scroll flex min-h-0 min-w-0 flex-1 phone:flex-col phone:overflow-y-auto">
        <section className="panel-scroll flex min-h-0 w-full flex-col gap-5 overflow-y-auto px-1 pt-2 pb-24 phone:shrink-0 phone:grow phone:overflow-visible phone:px-0">
          <div className="flex items-center justify-between gap-3">
            {view === "day" ? (
              <div className="flex items-center gap-1">
                <DayArrow label="Today" disabled={ahead === 0} onClick={() => setAhead(0)}>
                  ‹
                </DayArrow>
                <h1 className="caps w-24 text-center font-display text-[13px] font-bold text-ink/90">{ahead === 0 ? "Today" : "Tomorrow"}</h1>
                <DayArrow label="Tomorrow" disabled={ahead === 1} onClick={() => setAhead(1)}>
                  ›
                </DayArrow>
              </div>
            ) : (
              <h1 className="caps font-display text-[13px] font-bold text-ink/90">Repeating</h1>
            )}
            {view === "day" ? (
              <button type="button" onClick={() => setView("all")} className={toggle}>
                Repeating ›
              </button>
            ) : (
              <button type="button" onClick={() => setView("day")} className={toggle}>
                ‹ Today
              </button>
            )}
          </div>

          {alarmsAvailable ? null : <p className="-mt-3 text-[11.5px] text-muted">Alarms ring on your phone.</p>}

          {view === "day" ? (
            <DayRings
              snapshot={snapshot}
              date={date}
              act={act}
              onOpenAlarm={(alarm) => (alarm.time ? edit(alarm) : setOpening({ kind: "alarm", id: alarm.id }))}
              onOpenDeadline={(deadline) => setOpening({ kind: "deadline", id: deadline.id })}
              onMove={setMoving}
            />
          ) : (
            <AllAlarms alarms={snapshot.alarms} act={act} onEdit={edit} />
          )}
        </section>
      </div>

      <button
        type="button"
        onClick={() => (view === "day" ? setOpening({ kind: "new", date }) : setEditingId("new"))}
        aria-label={view === "day" ? "New on this day" : "New repeating alarm"}
        className="absolute right-4 bottom-4 flex h-14 w-14 items-center justify-center rounded-full bg-ember text-3xl leading-none text-canvas shadow-[var(--card-shadow)] hover:brightness-110"
      >
        +
      </button>

      {moving ? (
        <Popup label="Move this ring" onClose={() => setMoving(null)}>
          <MoveRing ring={moving} snapshot={snapshot} act={act} onDone={() => setMoving(null)} />
        </Popup>
      ) : null}

      {opening ? <EventDialog editing={opening} snapshot={snapshot} model={model} today={today} act={act} onClose={() => setOpening(null)} /> : null}

      {editing ? (
        <Popup label={editing === "new" ? "New repeating alarm" : editing.kind === "none" ? "Edit event" : "Edit alarm"} onClose={() => setEditingId(null)}>
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
              Delete this {editing.kind === "none" ? "event" : "alarm"}
            </button>
          )}
        </Popup>
      ) : null}
    </div>
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
          <Row
            key={alarm.id}
            time={alarm.time!}
            title={alarm.label || "Alarm"}
            detail={
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <WeekStrip weekdays={alarm.weekdays} />
                {stops ? <span>{stops}</span> : null}
              </span>
            }
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

// An arrow between today and tomorrow
function DayArrow({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none text-ink/70 hover:bg-ink/6 disabled:opacity-25 disabled:hover:bg-transparent phone:h-11 phone:w-11">
      {children}
    </button>
  );
}

// A time, days (none: once, at the next such time), a label and how it stops; filled from `alarm`
// when editing a repeating one
function AlarmForm({ alarm, onSave }: { alarm: Alarm | null; onSave: (alarm: Omit<Alarm, "id" | "enabled">) => unknown }) {
  const [time, setTime] = useState(alarm?.time ?? "07:00");
  const [days, setDays] = useState<Weekday[]>(alarm?.weekdays ?? []);
  const [label, setLabel] = useState(alarm?.label ?? "");
  const [kind, setKind] = useState<Alarm["kind"]>(alarm?.kind ?? "plain");
  const [end, setEnd] = useState(alarm?.time && alarm.minutes ? clockAfter(alarm.time, alarm.minutes) : "");

  const submit = () => {
    if (!time) return;
    const at = days.length === 0 ? nextOccurrence(time).toISOString() : null;
    onSave({ label: label.trim(), kind, sound: alarm?.sound ?? "default", at, time: at ? null : time, weekdays: days, minutes: end ? minutesFrom(time, end) : null });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TimeField label={kind === "none" ? "Starts" : "Time"} value={time} onChange={setTime} className={`${field} min-w-0 flex-1 text-base`} />
        <span className="text-[12px] text-muted">to</span>
        <TimeField label="Ends (optional)" optional value={end} onChange={setEnd} className={`${field} min-w-0 flex-1 text-base`} />
      </div>
      <textarea value={label} onChange={(event) => setLabel(event.target.value)} rows={4} placeholder="Label (optional)" aria-label="Label" className={`${field} block w-full resize-y leading-5`} />
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
        <select value={kind} aria-label="How it rings" onChange={(event) => setKind(event.target.value as Alarm["kind"])} className={`${field} flex-1`}>
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
