import { useEffect, useState } from "react";
import { Popup } from "../../components/Popup";
import { Switch } from "../../components/Switch";
import { TimeField } from "../../components/TimeField";
import { atTime, clockAfter, clockOf, daysBetween, minutesFrom, toISODate } from "../../shared/dates";
import type { GraphModel } from "../../shared/graphModel";
import type { Alarm, Deadline, ISODate, Snapshot } from "../../shared/types";
import { field, kindLabels } from "../alarmParts";
import type { Act } from "../home/HomePage";
import { NodePicker } from "../home/nodePickers";
import { dayLabel } from "./calendarViews";

/**
 * The Calendar's one pop-up. New: on a day, an event, an alarm or a deadline, chosen by three tabs.
 * An event and an alarm are one thing, a time on the day with an optional end, which rings or not;
 * the tab picks the default. Either: its day, times, label and how it rings, switch it off, or delete it. A deadline: its title,
 * day, alarm on the day and quest; tick it done, or delete it.
 * What is open is held by id and read from the latest data, so one deleted elsewhere closes it.
 */

// One-tap alarms on today, in minutes from now
const QUICK_MINUTES = [10, 30, 60, 120];

export type Editing = { kind: "new"; date: ISODate } | { kind: "alarm"; id: string } | { kind: "deadline"; id: string };

type DialogProps = { editing: Editing; snapshot: Snapshot; model: GraphModel; today: ISODate; act: Act; onClose: () => void };

export function EventDialog({ editing, snapshot, model, today, act, onClose }: DialogProps) {
  const alarm = editing.kind === "alarm" ? snapshot.alarms.find((candidate) => candidate.id === editing.id) : undefined;
  const deadline = editing.kind === "deadline" ? snapshot.deadlines.find((candidate) => candidate.id === editing.id) : undefined;
  const gone = editing.kind !== "new" && !alarm && !deadline;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);
  if (gone) return null;

  if (alarm?.time) {
    return (
      <Popup label={alarm.kind === "none" ? "Event" : "Alarm"} onClose={onClose}>
        <p className="text-[12.5px] text-muted">{alarm.label || "This"} repeats; change it under Alarms, Repeating.</p>
      </Popup>
    );
  }
  if (alarm) {
    return (
      <Popup label={alarm.kind === "none" ? "Event" : "Alarm"} onClose={onClose}>
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
  return <NewEvent date={(editing as { date: ISODate }).date} model={model} today={today} act={act} onClose={onClose} />;
}

// A new event, alarm or deadline on `date`, the kind picked by three tabs
function NewEvent({ date, model, today, act, onClose }: { date: ISODate; model: GraphModel; today: ISODate; act: Act; onClose: () => void }) {
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
      {kind !== "deadline" ? <AlarmFields key={kind} alarm={null} rings={kind === "alarm"} date={date} act={act} onDone={onClose} /> : <DeadlineFields deadline={null} date={date} model={model} today={today} act={act} onDone={onClose} />}
    </Popup>
  );
}

// A one-time alarm's or event's day, start, optional end, label and how it rings (or not); with
// `alarm`, that one's, which can also be switched off or deleted. New, `rings` picks the default. Only what changed is sent, so a field sent as it was can't win over a change
// made to it meanwhile on another device.
export function AlarmFields({ alarm, rings = true, date: initialDate, act, onDone }: { alarm: Alarm | null; rings?: boolean; date: ISODate; act: Act; onDone: () => void }) {
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(alarm ? clockOf(new Date(alarm.at!)) : "09:00");
  const [end, setEnd] = useState(alarm?.minutes ? clockAfter(clockOf(new Date(alarm.at!)), alarm.minutes) : "");
  const [label, setLabel] = useState(alarm?.label ?? "");
  const [kind, setKind] = useState<Alarm["kind"]>(alarm?.kind ?? (rings ? "plain" : "none"));
  const event = kind === "none";
  // Left at its day and time, an alarm keeps its exact moment: the form shows only minutes, and the
  // ring's key (which a skip or a snooze holds) is that moment
  const unmoved = alarm !== null && date === initialDate && time === clockOf(new Date(alarm.at!));
  const at = unmoved ? new Date(alarm.at!) : date && time ? atTime(date, time) : null;
  // An alarm already rung (kept a day for its snooze) can still be relabelled where it is; an event,
  // which never rings, can be put anywhere
  const past = !event && !unmoved && at !== null && at.getTime() <= Date.now();

  const save = () => {
    if (!at || past) return;
    const fields = { label: label.trim(), kind, at: at.toISOString(), minutes: end && time ? minutesFrom(time, end) : null };
    if (!alarm) void act("createAlarm", { ...fields, id: crypto.randomUUID(), sound: "default", time: null, weekdays: [], enabled: true });
    else {
      // The moment is compared as a moment: the same instant can be written two ways
      const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => (key === "at" ? Date.parse(value as string) !== Date.parse(alarm.at!) : value !== alarm[key as keyof Alarm])));
      if (Object.keys(changed).length > 0) void act("updateAlarm", alarm.id, changed);
    }
    onDone();
  };

  const quick = (minutes: number) => {
    void act("createAlarm", { id: crypto.randomUUID(), label: "", kind: "plain", sound: "default", at: new Date(Date.now() + minutes * 60_000).toISOString(), time: null, weekdays: [], enabled: true, minutes: null });
    onDone();
  };

  return (
    <div className="space-y-3">
      {!alarm && rings && initialDate === toISODate(new Date()) ? (
        <div className="flex flex-wrap gap-2">
          {QUICK_MINUTES.map((minutes) => (
            <button key={minutes} type="button" onClick={() => quick(minutes)} className="rounded-lg border border-ink/12 px-3.5 py-1.5 text-[13px] text-ink/80 hover:bg-ink/6 active:bg-ink/10 phone:min-h-11">
              In {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <input type="date" aria-label="Day" value={date} onChange={(event) => setDate(event.target.value)} className={`${field} min-w-0 flex-1`} />
      </div>
      <div className="flex items-center gap-2">
        <TimeField label={event ? "Starts" : "Time"} value={time} onChange={setTime} className={`${field} min-w-0 flex-1`} />
        <span className="text-[12px] text-muted">to</span>
        <TimeField label="Ends (optional)" optional value={end} onChange={setEnd} className={`${field} min-w-0 flex-1`} />
      </div>
      <textarea autoFocus={!alarm} value={label} onChange={(event) => setLabel(event.target.value)} rows={3} placeholder={event ? "What is on" : "What for (optional)"} aria-label="Label" className={`${field} block w-full resize-y leading-5`} />
      <div className="flex items-center gap-3">
        <select value={kind} aria-label="How it rings" onChange={(event) => setKind(event.target.value as Alarm["kind"])} className={`${field} flex-1`}>
          {(Object.keys(kindLabels) as Alarm["kind"][]).map((option) => (
            <option key={option} value={option}>
              {kindLabels[option]}
            </option>
          ))}
        </select>
        <button type="button" onClick={save} disabled={!at || past} className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50 phone:min-h-11">
          {alarm ? "Save" : "Set"}
        </button>
      </div>
      {past ? <p className="text-[11.5px] text-muted">That moment has passed.</p> : null}
      {alarm ? (
        <div className="flex items-center justify-between gap-3 border-t border-ink/8 pt-3">
          {alarm.kind !== "none" ? (
            <label className="flex items-center gap-3 text-[12.5px] text-ink/80">
              <Switch label="Rings" on={alarm.enabled} onChange={(enabled) => void act("updateAlarm", alarm.id, { enabled })} />
              {alarm.enabled ? "Rings" : "Off"}
            </label>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => {
              void act("deleteAlarm", alarm.id);
              onDone();
            }}
            className="text-[12.5px] text-muted hover:text-red-300 phone:min-h-11"
          >
            Delete this {alarm.kind === "none" ? "event" : "alarm"}
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
        <input type="date" aria-label="Due" value={date} onChange={(event) => setDate(event.target.value)} className={`${field} min-w-0 flex-1`} />
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
