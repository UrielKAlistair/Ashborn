import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useToday } from "../../lib/useToday";
import { dayOf, daysBetween, today, week, weekdayOf } from "../../shared/dates";
import { questOf, type GraphModel } from "../../shared/graphModel";
import { derivePriorities, needsFirstStep, prioritisedSteps } from "../../shared/priority";
import { byTime } from "../../shared/schedule";
import type { AlarmKind, GraphNode, Snapshot, Weekday } from "../../shared/types";
import type { Act } from "./HomePage";
import { paletteOf } from "../../lib/theme";
import { Capture, NodePicker } from "./Capture";
import { FocusCard } from "./FocusCard";
import { inInbox } from "../../shared/inbox";
import { SplitSteps } from "./SplitSteps";
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
  const { dayStartHour } = snapshot.settings;
  const date = useToday(dayStartHour);
  const [dayStartOpen, setDayStartOpen] = useState(false);
  // While the Inbox is being sorted, Focus steps aside: one card at a time
  const [sorting, setSorting] = useState(false);
  // With one step in Focus, the rest of the to-do waits behind a line, so the screen holds one thing
  const [showAll, setShowAllState] = useState(() => loadShowAll());
  const setShowAll = (show: boolean) => {
    setShowAllState(show);
    saveShowAll(show);
  };
  const weekday = weekdayOf(date);

  // Steps you can do now, of the chains that have a priority
  const priorities = derivePriorities(model, snapshot, date);
  const todo = prioritisedSteps(model, snapshot, priorities);
  const todoCount = todo.reduce((count, { steps }) => count + steps.length, 0);
  // Ready steps and empty quests nothing covers yet, so a priority can be given here without the
  // graph; untriaged Inbox items are left to the Inbox
  const unprioritised = snapshot.nodes.filter(
    (node) =>
      (node.parentId || needsFirstStep(model, node)) &&
      model.ready.has(node.id) &&
      !priorities.effective.has(node.id) &&
      questOf(model.byId, node).active &&
      !inInbox(model, node, snapshot.inboxId),
  );

  // The count is from the last change; once the next day starts it belongs to yesterday until the next one
  const progressToday = snapshot.progressToday.date === date ? snapshot.progressToday.count : 0;
  // The steps ticked today, latest first, behind the progress line; level-ups count but have no title
  const [doneOpen, setDoneOpen] = useState(false);
  const doneToday = snapshot.nodes
    .filter((node) => node.parentId && node.completedAt && dayOf(new Date(node.completedAt)) === date)
    .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!));

  const routines = snapshot.routines.filter((routine) => routine.weekdays.includes(weekday)).sort(byTime);
  // The time column only when some routine today has a time
  const timed = routines.some((routine) => routine.time);
  const checked = new Set(
    snapshot.routineChecks.filter((check) => check.date === date).map((check) => check.routineId),
  );
  const deadlines = snapshot.deadlines.filter((deadline) => daysBetween(date, deadline.dueDate) <= DEADLINE_HORIZON_DAYS);

  return (
    <section className="panel-scroll panel-lift flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto rounded-2xl border border-ink/8 bg-panel px-4 py-4">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-display text-lg font-semibold text-ink/90">Today</h2>
        <button
          type="button"
          onClick={() => setDayStartOpen((open) => !open)}
          title="When the day starts"
          className="font-mono text-[11px] text-muted tabular-nums hover:text-ink/70"
        >
          {weekday} {date}
        </button>
      </div>
      {dayStartOpen ? (
        <label className="-mt-4 flex items-center justify-end gap-2 px-1 text-[11.5px] text-muted">
          The day starts at
          <select
            value={dayStartHour}
            onChange={(event) => void act("updateSettings", { dayStartHour: Number(event.target.value) })}
            className="rounded-md border border-ink/10 bg-canvas/70 px-1.5 py-0.5 text-ink/80"
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {`${hour}`.padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {/* Held in place before the first tick too, so the cards below don't shift under the finger */}
      <div className={`-mt-5 px-1 ${progressToday > 0 ? "" : "invisible"}`} aria-hidden={progressToday === 0}>
        <button
          type="button"
          onClick={() => setDoneOpen(!doneOpen)}
          aria-expanded={doneOpen}
          disabled={doneToday.length === 0}
          className="flex items-center gap-1.5 text-[12px] text-muted enabled:hover:text-ink/85"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-ember" />
          {progressToday} {progressToday === 1 ? "step of progress" : "steps of progress"} today
          {doneToday.length > 0 ? <span className={`inline-block transition-transform ${doneOpen ? "rotate-90" : ""}`}>›</span> : null}
        </button>
        {doneOpen ? (
          <ul aria-label="Done today" className="mt-2 space-y-1 border-l border-ember/30 pl-3 text-[12.5px] text-ink/75">
            {doneToday.map((step) => (
              <li key={step.id} className="flex items-baseline gap-2">
                <Tick done onClick={() => void act("updateNode", step.id, { done: false })} className="translate-y-0.5" />
                <span className="min-w-0 flex-1">{step.title}</span>
                <span className="shrink-0 truncate text-[11px] text-muted">{questOf(model.byId, step).title}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <Capture snapshot={snapshot} model={model} act={act} onSorting={setSorting} />
      {sorting ? null : <FocusCard steps={todo.flatMap(({ steps }) => steps)} priorities={priorities} snapshot={snapshot} model={model} act={act} date={date} />}

      <Section title="Up next">
        {todo.length === 0 ? (
          <Empty>
            {model.children.get(null)?.length
              ? "Nothing with a priority is ready. Give a quest or step a priority, or link it to a deadline, and what you can start shows here."
              : "Start a quest on the graph. Once a chain in it has a priority, its next step shows here."}
          </Empty>
        ) : null}
        {todoCount > 0 && !showAll ? (
          <button type="button" onClick={() => setShowAll(true)} className="px-1 text-[12.5px] text-muted hover:text-ink/85">
            › {todoCount === 1 ? "Show the list" : `Show all ${todoCount} ready`}
          </button>
        ) : null}
        {showAll ? (
          <>
            {todo.map(({ priority, steps }) => (
              <div key={priority} data-priority={priority} className="space-y-0.5">
                <p className="flex items-center gap-2 px-1 pb-1 font-mono text-[11px] font-semibold text-[var(--mark)]">
                  P{priority}
                  <span className="h-px flex-1 bg-[color-mix(in_oklab,var(--mark)_25%,transparent)]" />
                </p>
                {steps.map((step) => {
                  if (needsFirstStep(model, step)) return <FirstStepRow key={step.id} quest={step} snapshot={snapshot} model={model} act={act} />;
                  const quest = questOf(model.byId, step);
                  const parent = model.byId.get(step.parentId!);
                  return (
                    <div key={step.id} className={rowClass}>
                      <Tick done={false} onClick={() => void act("updateNode", step.id, { done: true })} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug text-ink/90">{step.title}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(quest.color).dot}`} />
                          {quest.title}
                          {quest.id !== step.parentId ? ` · ${parent?.title}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            <button type="button" onClick={() => setShowAll(false)} className="px-1 text-[12.5px] text-muted hover:text-ink/85">
              ‹ Show only Now
            </button>
          </>
        ) : null}
      </Section>

      {unprioritised.length > 0 ? <Unprioritised steps={unprioritised} model={model} act={act} /> : null}

      <Section title="Routines" action={<RoutineForm act={act} />}>
        {routines.length === 0 ? (
          <Empty>No routines on {weekday}.</Empty>
        ) : (
          routines.map((routine) => (
            <div key={routine.id} className={`group ${rowClass}`}>
              <Tick done={checked.has(routine.id)} onClick={() => void act("setRoutineCheck", routine.id, date, !checked.has(routine.id))} className="mt-0.5" />
              {timed ? <span className="mt-px w-10 shrink-0 font-mono text-[11.5px] text-muted tabular-nums">{routine.time}</span> : null}
              <div className="min-w-0 flex-1">
                <p className={`text-[13px] leading-snug ${checked.has(routine.id) ? "text-muted line-through decoration-ink/25" : "text-ink/90"}`}>{routine.title}</p>
                {routine.alarm !== "none" || routine.cue ? (
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    {[routine.alarm !== "none" ? alarmLabels[routine.alarm] : null, routine.cue ? `if ${routine.cue}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
              <DeleteButton warning="Delete this routine and its ticks?" onDelete={() => void act("deleteRoutine", routine.id)} />
            </div>
          ))
        )}
      </Section>

      <Section title="Deadlines" action={<DeadlineForm act={act} model={model} />}>
        {deadlines.length === 0 ? (
          <Empty>Nothing due in the next {DEADLINE_HORIZON_DAYS} days.</Empty>
        ) : (
          deadlines.map((deadline) => {
            const days = daysBetween(date, deadline.dueDate);
            return (
              <div key={deadline.id} className={`group ${rowClass}`}>
                <Tick done={false} onClick={() => void act("completeDeadline", deadline.id)} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink/90">{deadline.title}</p>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-px font-mono text-[11px] tabular-nums ${
                        days < 0 ? "bg-red-500/15 text-red-300" : days <= 2 ? "bg-amber-400/15 text-amber-200" : "bg-ink/6 text-muted"
                      }`}
                    >
                      {days < 0 ? `${-days}d late` : days === 0 ? "today" : `${days}d`}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-muted tabular-nums">
                    {deadline.dueDate}
                    {deadline.alarmTime ? ` · alarm ${deadline.alarmTime}` : ""}
                  </p>
                  <NodePicker model={model} label="Deadline for" none="Not linked to a quest" value={deadline.nodeId} onChange={(nodeId) => void act("linkDeadline", deadline.id, nodeId)} className="-ml-1 mt-1 w-full truncate rounded-md bg-transparent px-1 py-0.5 text-[11.5px] text-muted hover:bg-ink/6" />
                </div>
                <DeleteButton warning="Delete this deadline?" onDelete={() => void act("deleteDeadline", deadline.id)} />
              </div>
            );
          })
        )}
      </Section>
    </section>
  );
}

// Ready steps without a priority, folded away by default; a P chip gives one its priority, which
// moves it into Up next
function Unprioritised({ steps, model, act }: { steps: GraphNode[]; model: GraphModel; act: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="-mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-1 text-[12.5px] text-muted hover:text-ink/85"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        Ready, no priority <span className="font-mono tabular-nums">{steps.length}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-0.5">
          {steps.map((step) => {
            const quest = questOf(model.byId, step);
            return (
              <div key={step.id} className={`group ${rowClass}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-ink/80">{step.title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(quest.color).dot}`} />
                    {needsFirstStep(model, step) ? "A quest with no steps yet" : quest.title}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1" role="group" aria-label={`Priority for ${step.title}`}>
                  {([1, 2, 3, 4] as const).map((priority) => (
                    <button
                      key={priority}
                      type="button"
                      data-priority={priority}
                      onClick={() => void act("updateNode", step.id, { priority })}
                      title={`Priority ${priority}`}
                      className="rounded-md border border-[color-mix(in_oklab,var(--mark)_35%,transparent)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--mark)] hover:bg-[color-mix(in_oklab,var(--mark)_14%,transparent)]"
                    >
                      P{priority}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// Whether the whole to-do shows under Focus, kept on this device
const showAllStorageKey = "ashborn-show-all-todo";

function loadShowAll() {
  try {
    return window.localStorage.getItem(showAllStorageKey) === "1";
  } catch {
    return false;
  }
}

function saveShowAll(show: boolean) {
  try {
    window.localStorage.setItem(showAllStorageKey, show ? "1" : "0");
  } catch {
    // Storage blocked: the list folds again next time
  }
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
    <div onKeyDown={closeOnEscape(() => setOpen(false))} className={popoverClass}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Routine, e.g. meal prep" className={fieldClass} />
      <input value={cue} onChange={(e) => setCue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="If… (cue), e.g. it's 7pm Sunday" className={fieldClass} />
      <div className="flex gap-1">
        {week.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]))}
            className={`flex-1 rounded-md border py-1 text-[10.5px] ${days.includes(day) ? "border-ember/50 bg-ember/12 text-ink/90" : "border-ink/10 text-muted"}`}
          >
            {day.slice(0, 2)}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title="Time (optional)" className={`${fieldClass} w-24 `} />
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

function DeadlineForm({ act, model }: { act: Act; model: GraphModel }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(today());
  const [alarmTime, setAlarmTime] = useState("");
  const [nodeId, setNodeId] = useState<string | null>(null);

  const submit = () => {
    if (!title.trim() || !dueDate) return;
    void act("createDeadline", { id: crypto.randomUUID(), title: title.trim(), dueDate, alarmTime: alarmTime || null, nodeId });
    setTitle("");
    setAlarmTime("");
    setNodeId(null);
    setOpen(false);
  };

  if (!open) return <AddButton onClick={() => setOpen(true)} />;

  return (
    <div onKeyDown={closeOnEscape(() => setOpen(false))} className={popoverClass}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Deadline" className={fieldClass} />
      <div className="flex gap-2">
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${fieldClass} `} />
        <input type="time" value={alarmTime} onChange={(e) => setAlarmTime(e.target.value)} title="Alarm on the day (optional)" className={`${fieldClass} w-24 `} />
      </div>
      <NodePicker model={model} label="Deadline for" none="Not linked to a quest" value={nodeId} onChange={setNodeId} className={fieldClass} />
      <FormButtons onCancel={() => setOpen(false)} onSubmit={submit} />
    </div>
  );
}

const fieldClass =
  "w-full rounded-lg border border-ink/10 bg-canvas/60 px-2.5 py-1.5 text-[13px] text-ink/85 placeholder:text-ink/35 focus:border-ember/50 focus:outline-none";
const popoverClass = "absolute right-0 top-8 z-10 w-72 space-y-2 rounded-xl border border-ink/10 bg-card p-3 shadow-[var(--card-shadow)]";
// A list row: quiet until hovered
const rowClass = "flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-ink/[0.04]";

// A quest in the to-do with nothing in it yet: instead of a tick, its first steps
function FirstStepRow({ quest, snapshot, model, act }: { quest: GraphNode; snapshot: Snapshot; model: GraphModel; act: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className={rowClass}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title="Add a first step"
          className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-dashed border-ink/30 text-[12px] leading-none text-muted hover:border-ember hover:text-ember"
        >
          +
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-ink/90">{quest.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(quest.color).dot}`} />A quest with no steps yet
          </p>
        </div>
      </div>
      {open ? <SplitSteps act={act} parentId={quest.id} onDone={() => setOpen(false)} graph={{ model, snapshot }} className="mt-1 w-full" /> : null}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="relative mb-2 flex items-center justify-between px-1">
        <p className="font-display text-[13px] font-semibold text-ink/70">{title}</p>
        {action}
      </div>
      <div role="group" aria-label={title} className="space-y-2">
        {children}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-ink/10 px-3 py-2.5 text-[12px] leading-relaxed text-muted">{children}</p>;
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
    <button type="button" onClick={onClick} title="Add" className="flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-muted hover:bg-ink/8 hover:text-ink/85">
      +
    </button>
  );
}

// A ×, shown on hover (always on a touch screen); the first click shows `warning`, a second within
// a few seconds deletes
function DeleteButton({ warning, onDelete }: { warning: string; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timeout = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [confirming]);

  return confirming ? (
    <button type="button" onClick={onDelete} className="shrink-0 rounded-md bg-red-500/20 px-2 py-0.5 text-[11px] leading-snug text-red-200">
      {warning}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title="Delete"
      className="shrink-0 text-xs text-ink/0 group-hover:text-muted hover:!text-red-300 pointer-coarse:text-muted"
    >
      ×
    </button>
  );
}

function FormButtons({ onCancel, onSubmit }: { onCancel: () => void; onSubmit: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-1 text-[12.5px]">
      <button type="button" onClick={onCancel} className="rounded-lg border border-ink/12 px-3 py-1 text-ink/70 hover:bg-ink/6">
        Cancel
      </button>
      <button type="button" onClick={onSubmit} className="rounded-lg bg-ember px-3 py-1 font-medium text-canvas hover:brightness-110">
        Add
      </button>
    </div>
  );
}
