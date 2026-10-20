import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useToday } from "../../lib/useToday";
import { daysBetween, today, week, weekdayOf } from "../../shared/dates";
import { threadOf, type GraphModel } from "../../shared/graphModel";
import { byTime } from "../../shared/schedule";
import type { AlarmKind, Snapshot, Weekday } from "../../shared/types";
import type { Act } from "./HomePage";
import { Tick } from "./Tick";

// Deadlines further out than this stay off the list
const DEADLINE_HORIZON_DAYS = 21;

export const alarmLabels: Record<AlarmKind, string> = { none: "No alarm", plain: "Alarm", walk: "Alarm, walk to stop", situps: "Alarm, sit-ups to stop" };

type TodayPanelProps = {
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
};

export function TodayPanel({ snapshot, model, act }: TodayPanelProps) {
  const date = useToday();
  const weekday = weekdayOf(date);

  // Steps you can do now: in a shown thread, nothing unfinished before or inside them
  const readySteps = snapshot.nodes.filter(
    (node) => node.parentId && model.ready.has(node.id) && threadOf(model.byId, node).active,
  );

  // The count is from the last change; after midnight it belongs to yesterday until the next one
  const progressToday = snapshot.progressToday.date === date ? snapshot.progressToday.count : 0;

  const routines = snapshot.routines.filter((routine) => routine.weekdays.includes(weekday)).sort(byTime);
  const checked = new Set(
    snapshot.routineChecks.filter((check) => check.date === date).map((check) => check.routineId),
  );
  const deadlines = snapshot.deadlines.filter((deadline) => daysBetween(date, deadline.dueDate) <= DEADLINE_HORIZON_DAYS);

  return (
    <section className="panel-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto rounded-3xl border border-white/10 bg-night-panel p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.26em] text-white/55">Today</h2>
        <p className="text-[11px] tracking-[0.14em] text-white/40">
          {weekday} {date}
        </p>
      </div>
      {progressToday > 0 ? (
        <p className="-mt-3 text-[10px] tracking-[0.14em] text-emerald-200/60">
          {progressToday} {progressToday === 1 ? "step of progress" : "steps of progress"} today
        </p>
      ) : null}

      <Section title="Up next">
        {readySteps.length === 0 ? <Empty>Add steps to a thread and the ones you can start show here.</Empty> : null}
        {readySteps.map((step) => {
          const thread = threadOf(model.byId, step);
          return (
            <div key={step.id} className="flex items-start gap-3 rounded-xl border border-white/8 bg-night/50 px-3 py-2">
              <Tick done={false} onClick={() => void act("updateNode", step.id, { done: true })} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-snug text-white/85">{step.title}</p>
                <p className="mt-1 truncate text-[10px] tracking-[0.12em] text-white/40">
                  {model.byId.get(step.parentId!)?.title}
                  {thread.id !== step.parentId ? ` · ${thread.title}` : ""}
                </p>
              </div>
            </div>
          );
        })}
      </Section>

      <Section title="Routines" action={<RoutineForm act={act} />}>
        {routines.length === 0 ? (
          <Empty>No routines on {weekday}.</Empty>
        ) : (
          routines.map((routine) => (
            <div key={routine.id} className="group flex items-start gap-3 rounded-xl border border-white/8 bg-night/50 px-3 py-2">
              <Tick done={checked.has(routine.id)} onClick={() => void act("setRoutineCheck", routine.id, date, !checked.has(routine.id))} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className={`text-xs ${checked.has(routine.id) ? "text-white/45 line-through" : "text-white/85"}`}>{routine.title}</p>
                {routine.time || routine.cue ? (
                  <p className="mt-0.5 text-[10px] tracking-[0.1em] text-white/40">
                    {[routine.time, routine.alarm !== "none" ? alarmLabels[routine.alarm].toLowerCase() : null, routine.cue ? `if ${routine.cue}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
              <DeleteButton onClick={() => void act("deleteRoutine", routine.id)} />
            </div>
          ))
        )}
      </Section>

      <Section title="Deadlines" action={<DeadlineForm act={act} />}>
        {deadlines.length === 0 ? (
          <Empty>Nothing due in the next {DEADLINE_HORIZON_DAYS} days.</Empty>
        ) : (
          deadlines.map((deadline) => {
            const days = daysBetween(date, deadline.dueDate);
            return (
              <div key={deadline.id} className="group flex items-start gap-3 rounded-xl border border-white/8 bg-night/50 px-3 py-2">
                <Tick done={false} onClick={() => void act("completeDeadline", deadline.id)} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-white/85">{deadline.title}</p>
                  <p className={`mt-0.5 text-[10px] tracking-[0.1em] ${days < 0 ? "text-red-300/80" : days <= 2 ? "text-amber-200/80" : "text-white/40"}`}>
                    {days < 0 ? `${-days}d overdue` : days === 0 ? "today" : `in ${days}d`} · {deadline.dueDate}
                    {deadline.alarmTime ? ` · alarm ${deadline.alarmTime}` : ""}
                  </p>
                </div>
                <DeleteButton onClick={() => void act("deleteDeadline", deadline.id)} />
              </div>
            );
          })
        )}
      </Section>
    </section>
  );
}

function RoutineForm({ act }: { act: Act }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [cue, setCue] = useState("");
  const [days, setDays] = useState<Weekday[]>([...week]);
  const [time, setTime] = useState("");
  const [alarm, setAlarm] = useState<AlarmKind>("none");

  const submit = () => {
    if (!title.trim() || days.length === 0) return;
    void act("createRoutine", { id: crypto.randomUUID(), title: title.trim(), cue: cue.trim(), weekdays: days, time: time || null, alarm: time ? alarm : "none" });
    setTitle("");
    setCue("");
    setTime("");
    setAlarm("none");
    setOpen(false);
  };

  if (!open) return <AddButton onClick={() => setOpen(true)} />;

  return (
    <div onKeyDown={closeOnEscape(() => setOpen(false))} className="absolute right-0 top-6 z-10 w-64 space-y-2 rounded-xl border border-white/12 bg-night-card/95 p-3">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Routine, e.g. meal prep" className={fieldClass} />
      <input value={cue} onChange={(e) => setCue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="If… (cue), e.g. it's 7pm Sunday" className={fieldClass} />
      <div className="flex gap-1">
        {week.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]))}
            className={`flex-1 rounded-md border py-1 text-[9px] uppercase ${days.includes(day) ? "border-white/30 bg-white/12 text-white/85" : "border-white/10 text-white/40"}`}
          >
            {day.slice(0, 2)}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title="Time (optional)" className={`${fieldClass} w-24 [color-scheme:dark]`} />
        <select value={alarm} disabled={!time} onChange={(e) => setAlarm(e.target.value as AlarmKind)} className={`${fieldClass} disabled:opacity-40`}>
          {(Object.keys(alarmLabels) as AlarmKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {alarmLabels[kind]}
            </option>
          ))}
        </select>
      </div>
      <FormButtons onCancel={() => setOpen(false)} onSubmit={submit} />
    </div>
  );
}

function DeadlineForm({ act }: { act: Act }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(today());
  const [alarmTime, setAlarmTime] = useState("");

  const submit = () => {
    if (!title.trim() || !dueDate) return;
    void act("createDeadline", { id: crypto.randomUUID(), title: title.trim(), dueDate, alarmTime: alarmTime || null });
    setTitle("");
    setAlarmTime("");
    setOpen(false);
  };

  if (!open) return <AddButton onClick={() => setOpen(true)} />;

  return (
    <div onKeyDown={closeOnEscape(() => setOpen(false))} className="absolute right-0 top-6 z-10 w-64 space-y-2 rounded-xl border border-white/12 bg-night-card/95 p-3">
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Deadline" className={fieldClass} />
      <div className="flex gap-2">
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${fieldClass} [color-scheme:dark]`} />
        <input type="time" value={alarmTime} onChange={(e) => setAlarmTime(e.target.value)} title="Alarm on the day (optional)" className={`${fieldClass} w-24 [color-scheme:dark]`} />
      </div>
      <FormButtons onCancel={() => setOpen(false)} onSubmit={submit} />
    </div>
  );
}

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-night/70 px-2.5 py-1.5 text-xs text-white/85 placeholder:text-white/35 focus:border-white/28 focus:outline-none";

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="relative mb-2 flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">{title}</p>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-[11px] text-white/35">{children}</p>;
}

// Escape closes a popover form; preventDefault keeps the navbar from also hiding the window
function closeOnEscape(close: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-white/10 px-1.5 text-xs leading-5 text-white/55 hover:border-white/24 hover:text-white/85">
      +
    </button>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Delete" className="shrink-0 text-xs text-white/0 group-hover:text-white/40 hover:!text-red-300">
      ×
    </button>
  );
}

function FormButtons({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: () => void }) {
  return (
    <div className="flex justify-end gap-2 text-[10px] uppercase tracking-[0.16em]">
      <button type="button" onClick={onCancel} className="rounded-md border border-white/10 px-2 py-1 text-white/55">
        Cancel
      </button>
      <button type="button" onClick={onSubmit} className="rounded-md border border-emerald-300/30 bg-emerald-400/12 px-2 py-1 text-emerald-100">
        Add
      </button>
    </div>
  );
}
