import { useEffect, useState } from "react";
import { KindChoice } from "../../components/Choice";
import { DateField } from "../../components/DateField";
import { Popup } from "../../components/Popup";
import { Switch } from "../../components/Switch";
import { TimeField } from "../../components/TimeField";
import { atTime, clockAfter, clockOf, daysBetween, minutesFrom, showTime, toISODate, week } from "../../shared/dates";
import type { GraphModel } from "../../shared/graphModel";
import { EVENT_DETAILS_MAX, type Alarm, type Deadline, type ISODate, type ScheduleEvent, type Snapshot, type Weekday } from "../../shared/types";
import { field, kindLabels } from "../alarmParts";
import { lasts, weekdaysText } from "../DayRings";
import type { Act } from "../home/HomePage";
import { NodePicker } from "../home/nodePickers";
import { dayLabel } from "./calendarViews";

/**
 * The Calendar's one pop-up. New: on a day, an event, an alarm or a deadline, chosen by three tabs.
 * An event (EventFields) is a time on the schedule with an optional end, details, and an alarm at its
 * start or none. One added on a day happens once; repeating events are added on the Alarms screen's
 * Repeating view, and an event stays once or repeating when edited. An alarm (AlarmFields) is a one-time ring. A deadline: its title,
 * day, alarm on the day and quest. An event opens on what it is (EventSummary: when, how long,
 * whether it rings, its details), with Edit for its form; an alarm or a deadline opens on its form.
 * What is open is held by id and read from the latest data, so one deleted elsewhere closes it.
 */

// One-tap alarms on today, in minutes from now
const QUICK_MINUTES = [10, 30, 60, 120];

export type Editing = { kind: "new"; date: ISODate } | { kind: "alarm"; id: string } | { kind: "event"; id: string } | { kind: "deadline"; id: string };

type DialogProps = { editing: Editing; snapshot: Snapshot; model: GraphModel; today: ISODate; act: Act; onClose: () => void };

export function EventDialog({ editing, snapshot, model, today, act, onClose }: DialogProps) {
  const alarm = editing.kind === "alarm" ? snapshot.alarms.find((candidate) => candidate.id === editing.id) : undefined;
  const event = editing.kind === "event" ? snapshot.events.find((candidate) => candidate.id === editing.id) : undefined;
  const deadline = editing.kind === "deadline" ? snapshot.deadlines.find((candidate) => candidate.id === editing.id) : undefined;
  const gone = editing.kind !== "new" && !alarm && !event && !deadline;
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (gone) return null;

  if (event) {
    return (
      <Popup label={changing ? "Edit event" : "Event"} onClose={onClose}>
        {changing ? <EventFields event={event} repeating={event.time !== null} date={event.at ? toISODate(new Date(event.at)) : today} act={act} onDone={onClose} /> : <EventSummary event={event} onEdit={() => setChanging(true)} />}
      </Popup>
    );
  }
  if (alarm?.time) {
    return (
      <Popup label="Alarm" onClose={onClose}>
        <p className="text-[12.5px] text-muted">{alarm.label || "This"} repeats; change it under Alarms, Repeating.</p>
      </Popup>
    );
  }
  if (alarm) {
    return (
      <Popup label="Alarm" onClose={onClose}>
        <AlarmFields alarm={alarm} date={toISODate(new Date(alarm.at!))} act={act} onDone={onClose} />
      </Popup>
    );
  }
  if (deadline) {
    return (
      <Popup label="Deadline" onClose={onClose}>
        <DeadlineFields deadline={deadline} date={deadline.dueDate} model={model} today={today} act={act} onDone={onClose} />
      </Popup>
    );
  }
  return <NewEntry date={(editing as { date: ISODate }).date} model={model} today={today} act={act} onClose={onClose} />;
}

// A new event, alarm or deadline on `date`, the kind picked by three tabs
function NewEntry({ date, model, today, act, onClose }: { date: ISODate; model: GraphModel; today: ISODate; act: Act; onClose: () => void }) {
  const [kind, setKind] = useState<"event" | "alarm" | "deadline">("event");
  const tab = (value: typeof kind, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={kind === value}
      onClick={() => setKind(value)}
      className={`flex-1 rounded-md py-1.5 text-[12.5px] phone:min-h-11 ${kind === value ? "bg-ember/15 text-ember" : "text-muted hover:bg-ink/6"}`}
    >
      {label}
    </button>
  );
  return (
    <Popup label={`New on ${dayLabel(date)}`} onClose={onClose}>
      <div role="tablist" className="flex gap-1 rounded-lg border border-ink/10 p-1">
        {tab("event", "Event")}
        {tab("alarm", "Alarm")}
        {tab("deadline", "Deadline")}
      </div>
      {kind === "event" ? <EventFields event={null} repeating={false} date={date} act={act} onDone={onClose} /> : null}
      {kind === "alarm" ? <AlarmFields alarm={null} date={date} act={act} onDone={onClose} /> : null}
      {kind === "deadline" ? <DeadlineFields deadline={null} date={date} model={model} today={today} act={act} onDone={onClose} /> : null}
    </Popup>
  );
}

// What an event is, to read: its title, when and how long, whether it rings at its start, its details
function EventSummary({ event, onEdit }: { event: ScheduleEvent; onEdit: () => void }) {
  const start = event.time ?? clockOf(new Date(event.at!));
  const day = event.time ? `Every ${weekdaysText(event.weekdays)}` : dayLabel(toISODate(new Date(event.at!)), { weekday: "long", day: "numeric", month: "long" });
  const span = event.minutes ? `${showTime(start)} – ${showTime(clockAfter(start, event.minutes))} (${lasts(event.minutes)})` : showTime(start);
  return (
    <div className="space-y-3">
      <p className="text-[15px] leading-snug text-ink/90 [overflow-wrap:anywhere] whitespace-pre-line">{event.title || "Event"}</p>
      <p className="text-[12.5px] text-muted">
        {day} · {span}
        <br />
        {event.rings ? `Rings at its start${event.rings === "plain" ? "" : `, stops after ${kindLabels[event.rings].toLowerCase()}`}` : "Doesn't ring"}
      </p>
      {event.details ? <p className="max-h-72 overflow-y-auto border-t border-ink/8 pt-3 text-[13px] leading-5 text-ink/85 [overflow-wrap:anywhere] whitespace-pre-line select-text">{event.details}</p> : null}
      <div className="flex justify-end">
        <button type="button" onClick={onEdit} className="rounded-lg border border-ink/12 px-3 py-1.5 text-[13px] text-ink/80 hover:bg-ink/6 phone:min-h-11">
          Edit
        </button>
      </div>
    </div>
  );
}

// An event's title, day (or, `repeating`, the weekdays it repeats on), start, optional end, ring at its start and
// details; with `event`, that one's, which can also be deleted. Only what changed is sent, so a field
// sent as it was can't win over a change made to it meanwhile on another device.
export function EventFields({ event, repeating, date: initialDate, act, onDone }: { event: ScheduleEvent | null; repeating: boolean; date: ISODate; act: Act; onDone: () => void }) {
  const initialTime = event ? (event.time ?? clockOf(new Date(event.at!))) : "09:00";
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(initialDate);
  const [days, setDays] = useState<Weekday[]>(event?.weekdays ?? []);
  const [time, setTime] = useState(initialTime);
  const [end, setEnd] = useState(event?.minutes ? clockAfter(initialTime, event.minutes) : "");
  const [rings, setRings] = useState<ScheduleEvent["rings"]>(event?.rings ?? null);
  const [details, setDetails] = useState(event?.details ?? "");
  // Left at its day and start, a one-off keeps its exact moment, which its start ring's key holds
  const unmoved = event?.at != null && !repeating && date === initialDate && time === initialTime;
  const at = repeating ? null : unmoved ? event!.at : date && time ? atTime(date, time).toISOString() : null;
  const ready = Boolean(title.trim() && time && (repeating ? days.length > 0 : at));

  const save = () => {
    if (!ready) return;
    const fields: Omit<ScheduleEvent, "id"> = { title: title.trim(), details: details.trim(), at, time: repeating ? time : null, weekdays: repeating ? days : [], minutes: end ? minutesFrom(time, end) : null, rings };
    if (!event) void act("createEvent", { ...fields, id: crypto.randomUUID() });
    else {
      const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(event[key as keyof ScheduleEvent])));
      if (Object.keys(changed).length > 0) void act("updateEvent", event.id, changed);
    }
    onDone();
  };

  return (
    <div className="space-y-3">
      <input autoFocus={!event} value={title} onChange={(input) => setTitle(input.target.value)} placeholder="What is on" aria-label="Event" className={`${field} w-full`} />
      {repeating ? <Weekdays days={days} onChange={setDays} /> : <DateField label="Day" value={date} onChange={setDate} className={`${field} w-full`} />}
      <div className="flex items-center gap-2">
        <TimeField label="Starts" value={time} onChange={setTime} className={`${field} min-w-0 flex-1`} />
        <span className="text-[12px] text-muted">to</span>
        <TimeField label="Ends (optional)" optional value={end} onChange={setEnd} className={`${field} min-w-0 flex-1`} />
      </div>
      <KindChoice label="Ring at its start" none="No ring" value={rings ?? "none"} onChange={(choice) => setRings(choice === "none" ? null : choice)} />
      <textarea value={details} onChange={(input) => setDetails(input.target.value)} maxLength={EVENT_DETAILS_MAX} rows={4} placeholder="Details: where, who, notes (optional)" aria-label="Details" className={`${field} block w-full resize-y leading-5`} />
      <div className="flex items-center justify-end gap-3">
        {event ? (
          <button
            type="button"
            onClick={() => {
              void act("deleteEvent", event.id);
              onDone();
            }}
            className="mr-auto text-[12.5px] text-muted hover:text-red-300 phone:min-h-11"
          >
            Delete this event
          </button>
        ) : null}
        <button type="button" onClick={save} disabled={!ready} className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50 phone:min-h-11">
          {event ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );
}

// A one-time alarm's day, time, label and how it stops; with `alarm`, that one's, which can also be
// switched off or deleted. Only what changed is sent (as for an event, above).
export function AlarmFields({ alarm, date: initialDate, act, onDone }: { alarm: Alarm | null; date: ISODate; act: Act; onDone: () => void }) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(alarm ? clockOf(new Date(alarm.at!)) : "09:00");
  const [label, setLabel] = useState(alarm?.label ?? "");
  const [kind, setKind] = useState<Alarm["kind"]>(alarm?.kind ?? "plain");
  // Left at its day and time, an alarm keeps its exact moment: the form shows only minutes, and the
  // ring's key (which a skip or a snooze holds) is that moment
  const unmoved = alarm !== null && date === initialDate && time === clockOf(new Date(alarm.at!));
  const at = unmoved ? new Date(alarm.at!) : date && time ? atTime(date, time) : null;

  const save = () => {
    if (!at) return;
    const fields = { label: label.trim(), kind, at: at.toISOString() };
    if (!alarm) void act("createAlarm", { ...fields, id: crypto.randomUUID(), sound: "default", time: null, weekdays: [], enabled: true, eventId: null });
    else {
      // The moment is compared as a moment: the same instant can be written two ways
      const changed: Partial<Alarm> = Object.fromEntries(Object.entries(fields).filter(([key, value]) => (key === "at" ? Date.parse(value) !== Date.parse(alarm.at!) : value !== alarm[key as keyof Alarm])));
      if (Object.keys(changed).length > 0) void act("updateAlarm", alarm.id, changed);
    }
    onDone();
  };

  const quick = (minutes: number) => {
    void act("createAlarm", { id: crypto.randomUUID(), label: "", kind: "plain", sound: "default", at: new Date(Date.now() + minutes * 60_000).toISOString(), time: null, weekdays: [], enabled: true, eventId: null });
    onDone();
  };

  return (
    <div className="space-y-3">
      {!alarm && initialDate === toISODate(new Date()) ? (
        <div className="flex flex-wrap gap-2">
          {QUICK_MINUTES.map((minutes) => (
            <button key={minutes} type="button" onClick={() => quick(minutes)} className="rounded-lg border border-ink/12 px-3.5 py-1.5 text-[13px] text-ink/80 hover:bg-ink/6 active:bg-ink/10 phone:min-h-11">
              In {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <DateField label="Day" value={date} onChange={setDate} className={`${field} min-w-0 flex-1`} />
        <TimeField label="Time" value={time} onChange={setTime} className={`${field} min-w-0 flex-1`} />
      </div>
      <textarea autoFocus={!alarm} value={label} onChange={(input) => setLabel(input.target.value)} rows={3} placeholder="What for (optional)" aria-label="Label" className={`${field} block w-full resize-y leading-5`} />
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <KindChoice label="How it rings" value={kind} onChange={setKind} />
        </div>
        <button type="button" onClick={save} disabled={!at} className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50 phone:min-h-11">
          {alarm ? "Save" : "Set"}
        </button>
      </div>
      {alarm ? (
        <div className="flex items-center justify-between gap-3 border-t border-ink/8 pt-3">
          <label className="flex items-center gap-3 text-[12.5px] text-ink/80">
            <Switch label="Rings" on={alarm.enabled} onChange={(enabled) => void act("updateAlarm", alarm.id, { enabled })} />
            {alarm.enabled ? "Rings" : "Off"}
          </label>
          <button
            type="button"
            onClick={() => {
              void act("deleteAlarm", alarm.id);
              onDone();
            }}
            className="text-[12.5px] text-muted hover:text-red-300 phone:min-h-11"
          >
            Delete this alarm
          </button>
        </div>
      ) : null}
    </div>
  );
}

// A deadline's title, day, alarm on the day and quest; with `deadline`, that one's, which can also be
// ticked done or deleted, and of which only what changed is sent (as for an alarm, above)
function DeadlineFields({ deadline, date: initialDate, model, today, act, onDone }: { deadline: Deadline | null; date: ISODate; model: GraphModel; today: ISODate; act: Act; onDone: () => void }) {
  const [title, setTitle] = useState(deadline?.title ?? "");
  const [date, setDate] = useState(initialDate);
  const [alarmTime, setAlarmTime] = useState(deadline?.alarmTime ?? "");
  const [nodeId, setNodeId] = useState(deadline?.nodeId ?? null);
  const days = daysBetween(today, date);

  const save = () => {
    if (!title.trim() || !date) return;
    const fields = { title: title.trim(), dueDate: date, alarmTime: alarmTime || null, nodeId };
    if (!deadline) void act("createDeadline", { id: crypto.randomUUID(), ...fields });
    else {
      const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== deadline[key as keyof typeof fields]));
      if (Object.keys(changed).length > 0) void act("updateDeadline", deadline.id, changed);
    }
    onDone();
  };

  return (
    <div className="space-y-3">
      <input autoFocus={!deadline} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => event.key === "Enter" && !event.nativeEvent.isComposing && save()} placeholder="What is due" aria-label="Deadline" className={`${field} w-full`} />
      <div className="flex flex-wrap gap-2">
        <DateField label="Due" value={date} onChange={setDate} className={`${field} min-w-0 flex-1`} />
        <TimeField label="Alarm on the day (optional)" optional value={alarmTime} onChange={setAlarmTime} className={`${field} w-32`} />
      </div>
      {date ? <p className="text-[12px] text-muted">{days < 0 ? `${-days}d late` : days === 0 ? "Due today" : `Due in ${days}d`}</p> : null}
      <NodePicker model={model} label="Deadline for" none="Not linked to a quest" value={nodeId} onChange={setNodeId} className={`${field} w-full`} />
      <div className="flex items-center justify-end gap-3">
        {deadline ? (
          <>
            <button
              type="button"
              onClick={() => {
                void act("deleteDeadline", deadline.id);
                onDone();
              }}
              className="mr-auto text-[12.5px] text-muted hover:text-red-300 phone:min-h-11"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => {
                void act("completeDeadline", deadline.id);
                onDone();
              }}
              className="rounded-lg border border-ink/12 px-3 py-1.5 text-[13px] text-ink/80 hover:bg-ink/6 phone:min-h-11"
            >
              Done
            </button>
          </>
        ) : null}
        <button type="button" onClick={save} disabled={!title.trim() || !date} className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50 phone:min-h-11">
          {deadline ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );
}

// The weekdays a repeating event is on, as toggles
function Weekdays({ days, onChange }: { days: Weekday[]; onChange: (days: Weekday[]) => void }) {
  return (
    <>
      <div className="flex gap-1" role="group" aria-label="Repeats on">
        {week.map((weekday) => (
          <button
            key={weekday}
            type="button"
            aria-pressed={days.includes(weekday)}
            aria-label={`Repeats on ${weekday}`}
            onClick={() => onChange(days.includes(weekday) ? days.filter((d) => d !== weekday) : [...days, weekday])}
            className={`flex-1 rounded-md border py-1.5 text-[11.5px] phone:min-h-11 ${days.includes(weekday) ? "border-ember/50 bg-ember/15 text-ember" : "border-ink/10 text-muted hover:bg-ink/6"}`}
          >
            {weekday.slice(0, 2)}
          </button>
        ))}
      </div>
      <p className="-mt-1 text-[11.5px] text-muted">{days.length > 0 ? `Every ${weekdaysText(days)}` : "Pick the days it repeats on"}</p>
    </>
  );
}
