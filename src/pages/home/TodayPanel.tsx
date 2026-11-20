import { TimeField } from "../../components/TimeField";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { useToday } from "../../lib/useToday";
import { clockOf, daysBetween, showTime, today, week, weekdayOf } from "../../shared/dates";
import { ringsIn } from "../DayRings";
import { isDone, questOf, type GraphModel } from "../../shared/graphModel";
import { derivePriorities, needsFirstStep, prioritisedSteps, type Priorities } from "../../shared/priority";
import { byTime, eventsOn, upcomingAlarms } from "../../shared/schedule";
import { useNow } from "../../lib/useNow";
import { priorities as priorityLevels, type AlarmKind, type Deadline, type GraphNode, type ISODate, type Priority, type Snapshot, type Weekday } from "../../shared/types";
import type { Act } from "./HomePage";
import { paletteOf } from "../../lib/theme";
import { NodePicker } from "./nodePickers";
import { FocusCard } from "./FocusCard";
import { goneQuiet } from "../../shared/goneQuiet";
import { GoneQuiet } from "./GoneQuiet";
import { useOneTap } from "./oneTap";
import { Tick } from "./Tick";

// Deadlines further out than this stay off the list
const DEADLINE_HORIZON_DAYS = 21;

export const alarmLabels: Record<AlarmKind, string> = { none: "No alarm", plain: "Alarm", walk: "Alarm, walk to stop", situps: "Alarm, sit-ups to stop" };

type TodayPanelProps = {
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
};

/**
 * Today: the desktop's right-hand panel, and the phone's To-do screen. Top to bottom: the date; what is on
 * now and next on today's schedule; Now, the to-do; deadlines overdue or due within three weeks; the
 * quests gone quiet, asking what's up; the ready steps no priority covers yet; and today's routines.
 */
export function TodayPanel({ snapshot, model, act }: TodayPanelProps) {
  const date = useToday();
  const weekday = weekdayOf(date);

  // Worked out again when the data or the day changes, not when a section opens or closes
  const { priorities, todo, quiet, unprioritised } = useMemo(() => {
    // Steps you can do now, of the chains that have a priority
    const priorities = derivePriorities(model, snapshot);
    const todo = prioritisedSteps(model, snapshot, priorities);
    // Ready steps and empty quests nothing covers yet, so a priority can be given here without the
    // graph; quiet quests' steps are left to Gone quiet
    const quiet = goneQuiet(model, priorities, date);
    const quietIds = new Set(quiet.map(({ quest }) => quest.id));
    const unprioritised = snapshot.nodes.filter(
      (node) =>
        (node.parentId || needsFirstStep(model, node)) &&
        model.ready.has(node.id) &&
        !priorities.effective.has(node.id) &&
        !quietIds.has(questOf(model.byId, node).id),
    );
    return { priorities, todo, quiet, unprioritised };
  }, [model, snapshot, date]);
  const todoCount = todo.reduce((count, { steps }) => count + steps.length, 0);



  return (
    <section className="panel-scroll flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1 py-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="caps font-display text-[13px] font-bold text-ink/90">Today</h2>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {weekday} {date}
        </span>
      </div>

      <ComingUp snapshot={snapshot} />

      <FocusCard
        steps={todo.flatMap(({ steps }) => steps)}
        priorities={priorities}
        model={model}
        act={act}
        empty={
          <p className="px-2 pb-1 text-[12px] leading-relaxed text-muted">
            {!model.children.has(null)
              ? "Start a quest on the graph. Once a chain in it has a priority, its next step shows here."
              : unprioritised.length > 0
                ? "Nothing with a priority is ready. Give a quest a priority below, and its next step shows here."
                : "Nothing with a priority is ready. Give a quest or step a priority, and what you can start shows here."}
          </p>
        }
      />

      <Deadlines snapshot={snapshot} model={model} act={act} date={date} />

      <GoneQuiet quiet={quiet} act={act} />

      {unprioritised.length > 0 ? <Unprioritised steps={unprioritised} model={model} act={act} priorities={priorities} openAtFirst={todoCount === 0} /> : null}

      <Routines snapshot={snapshot} act={act} date={date} weekday={weekday} />
    </section>
  );
}

// How many of today's coming times Coming up shows
const COMING_UP = 2;

// Today's schedule at a glance: the events on now, then the next times still to come today, rings and
// events alike (the Alarms screen has the whole day). Nothing shows on a day with nothing left.
function ComingUp({ snapshot }: { snapshot: Snapshot }) {
  const now = useNow();
  const date = today();
  const events = eventsOn(snapshot, date);
  const endOf = (at: Date, minutes: number | null) => new Date(at.getTime() + (minutes ?? 0) * 60_000);
  const on = events.filter((event) => event.at <= now && now < endOf(event.at, event.minutes));
  const coming = [
    ...events.filter((event) => event.at > now).map((event) => ({ key: event.key, at: event.at, title: event.title, rings: false })),
    ...upcomingAlarms(snapshot, now, 1).map((ring) => ({ key: ring.key, at: ring.at, title: ring.title.replace(/ \(moved from .+\)$/s, ""), rings: true })),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, COMING_UP);
  if (on.length === 0 && coming.length === 0) return null;
  return (
    <div role="group" aria-label="Coming up today" className="space-y-1.5 px-1">
      {on.map((event) => (
        <p key={event.key} className="flex items-baseline gap-2.5 text-[13px]">
          <span className="w-[78px] shrink-0 whitespace-nowrap font-['Silkscreen'] text-[10px] text-emerald-300">ON NOW</span>
          <span className="min-w-0 flex-1 truncate text-ink/90">{event.title}</span>
          {event.minutes ? <span className="shrink-0 text-[11px] text-muted">to {showTime(clockOf(endOf(event.at, event.minutes)))}</span> : null}
        </p>
      ))}
      {coming.map((item) => (
        <p key={item.key} className="flex items-baseline gap-2.5 text-[13px]">
          <span className={`w-[78px] shrink-0 whitespace-nowrap font-['Silkscreen'] text-[11px] tabular-nums ${item.rings ? "text-ember" : "text-emerald-300"}`}>{showTime(clockOf(item.at))}</span>
          <span className="min-w-0 flex-1 truncate text-ink/80">{item.title}</span>
          <span className="shrink-0 text-[11px] text-muted">{ringsIn(item.at, now)}</span>
        </p>
      ))}
    </div>
  );
}

// Open deadlines, overdue or due within DEADLINE_HORIZON_DAYS, soonest first, each with how far off
// it is and the quest it belongs with
function Deadlines({ snapshot, model, act, date }: { snapshot: Snapshot; model: GraphModel; act: Act; date: ISODate }) {
  // The deadline whose title was clicked, edited in a pop-over on its row
  const [editingId, setEditingId] = useState<string | null>(null);
  // Soonest first: one added or moved since the last read sits at the end of the list as held
  const deadlines = snapshot.deadlines
    .filter((deadline) => daysBetween(date, deadline.dueDate) <= DEADLINE_HORIZON_DAYS)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <Section title="Deadlines" action={<DeadlineForm act={act} model={model} />}>
      {deadlines.length === 0 ? (
        <Empty>Nothing due in the next {DEADLINE_HORIZON_DAYS} days.</Empty>
      ) : (
        deadlines.map((deadline) => {
          const days = daysBetween(date, deadline.dueDate);
          return (
            <div key={deadline.id} className={`group relative ${rowClass}`}>
              <Tick done={false} onClick={() => void act("completeDeadline", deadline.id)} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <button type="button" onClick={() => setEditingId(deadline.id)} title="Change this deadline" className="min-w-0 flex-1 text-left text-[13px] leading-snug text-ink/90 hover:text-ember">
                    {deadline.title}
                  </button>
                  <span
                    className={`shrink-0 rounded-md px-1.5 py-px font-mono text-[11px] tabular-nums ${
                      days < 0 ? "bg-red-500/15 text-red-300" : days <= 2 ? "bg-amber-400/15 text-amber-200" : "bg-ink/6 text-muted"
                    }`}
                  >
                    {days < 0 ? `${-days}d late` : days === 0 ? "today" : `${days}d`}
                  </span>
                </div>
                {/* The quest it belongs with sits on the date's line: a link only groups (194) */}
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="shrink-0 font-mono tabular-nums">
                    {deadline.dueDate}
                    {deadline.alarmTime ? ` · alarm ${deadline.alarmTime}` : ""} ·
                  </span>
                  <NodePicker model={model} label="Deadline for" none="No quest" value={deadline.nodeId} onChange={(nodeId) => void act("updateDeadline", deadline.id, { nodeId })} className="-mx-1 min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-md bg-transparent px-1 py-0.5 text-[11.5px] text-muted hover:bg-ink/6 hover:text-ink/80 pointer-coarse:min-h-8" />
                </div>
              </div>
              <DeleteButton warning="Delete this deadline?" onDelete={() => void act("deleteDeadline", deadline.id)} />
              {editingId === deadline.id ? <DeadlineFields deadline={deadline} act={act} model={model} onDone={() => setEditingId(null)} /> : null}
            </div>
          );
        })
      )}
    </Section>
  );
}

// Today's routines, timed ones first, each ticked for today
function Routines({ snapshot, act, date, weekday }: { snapshot: Snapshot; act: Act; date: ISODate; weekday: Weekday }) {
  const routines = snapshot.routines.filter((routine) => routine.weekdays.includes(weekday)).sort(byTime);
  // The time column only when some routine today has a time
  const timed = routines.some((routine) => routine.time);
  const checked = new Set(
    snapshot.routineChecks.filter((check) => check.date === date).map((check) => check.routineId),
  );

  return (
    <Section title="Routines" action={<RoutineForm act={act} />}>
      {routines.length === 0 ? (
        <Empty>No routines on {weekday}.</Empty>
      ) : (
        routines.map((routine) => (
          <div key={routine.id} className={`group ${rowClass}`}>
            <Tick done={checked.has(routine.id)} onClick={() => void act("setRoutineCheck", routine.id, date, !checked.has(routine.id))} className="mt-0.5" />
            {timed ? <span className="mt-px w-14 shrink-0 font-mono text-[11.5px] text-muted tabular-nums">{routine.time ? showTime(routine.time) : ""}</span> : null}
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
  );
}

// Ready steps without a priority, folded away by default; a P chip gives one its priority, which
// moves it into Now
// Open from the start when nothing has a priority, since giving one is then the only way to a Now
function Unprioritised({ steps, model, act, priorities, openAtFirst }: { steps: GraphNode[]; model: GraphModel; act: Act; priorities: Priorities; openAtFirst: boolean }) {
  const [open, setOpen] = useState(openAtFirst);
  const oneTap = useOneTap();
  return (
    <div className="-mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="caps flex w-full items-center gap-1.5 px-1 font-display text-[11px] font-semibold text-ink/65 hover:text-ink/85 pointer-coarse:min-h-8"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        Ready, no priority <span className="font-mono tabular-nums">{steps.length}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-0.5">
          <p className="px-1 pb-1 text-[11px] text-muted">P1 most urgent, P4 least. On a quest, it covers all its steps.</p>
          {byQuest(steps, model).map(({ quest, steps: inQuest, open }) =>
            open <= 1 ? (
              <div key={inQuest[0].id} className={rowClass}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-ink/80">{inQuest[0].title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-muted">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(priorities.best.get(quest.id)).dot}`} />
                    {needsFirstStep(model, inQuest[0]) ? "A quest with no steps yet" : quest.title}
                  </p>
                </div>
                <PriorityChips label={`Priority for ${inQuest[0].title}`} onPick={oneTap((priority) => void act("updateNode", inQuest[0].id, { priority }))} />
              </div>
            ) : (
              // More to do in the quest than this: a priority on the quest covers all of it, the steps it
              // unlocks too (a step's own covers only what leads to it)
              <div key={quest.id}>
                <div className={rowClass}>
                  <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] leading-snug font-medium text-ink/85">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(priorities.best.get(quest.id)).dot}`} />
                    <span className="truncate">{quest.title}</span>
                    <span className="shrink-0 text-[11.5px] font-normal text-muted">
                      {inQuest.length} ready of {open}
                    </span>
                  </p>
                  <PriorityChips label={`Priority for all of ${quest.title}`} onPick={oneTap((priority) => void act("updateNode", quest.id, { priority }))} />
                </div>
                {inQuest.map((step) => (
                  <div key={step.id} className={`${rowClass} py-1.5 pl-6`}>
                    <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink/75">{step.title}</p>
                    <PriorityChips label={`Priority for ${step.title}`} onPick={oneTap((priority) => void act("updateNode", step.id, { priority }))} quiet />
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

// The ready steps in their quests, in the order the quests first come up, with how many open steps
// each quest holds in all, ready or waiting on another; a box with nothing open inside is one itself,
// still to be ticked
function byQuest(steps: GraphNode[], model: GraphModel) {
  const groups = new Map<string, { quest: GraphNode; steps: GraphNode[]; open: number }>();
  for (const step of steps) {
    const quest = questOf(model.byId, step);
    const group = groups.get(quest.id) ?? { quest, steps: [], open: openSteps(model, quest.id) };
    group.steps.push(step);
    groups.set(quest.id, group);
  }
  return [...groups.values()];
}

function openSteps(model: GraphModel, id: string): number {
  return (model.children.get(id) ?? []).reduce((count, step) => {
    const inside = model.children.has(step.id) ? openSteps(model, step.id) : 0;
    return count + (inside > 0 ? inside : isDone(step) || model.shelved.has(step.id) ? 0 : 1);
  }, 0);
}

// `quiet`: drawn in plain ink until pointed at, for a step under a quest's own chips
function PriorityChips({ label, onPick, quiet = false }: { label: string; onPick: (priority: Priority) => void; quiet?: boolean }) {
  return (
    <div className="flex shrink-0 gap-1" role="group" aria-label={label}>
      {priorityLevels.map((priority) => (
        <button
          key={priority}
          type="button"
          data-priority={priority}
          onClick={() => onPick(priority)}
          title={`Priority ${priority}`}
          className={`rounded-md border px-1.5 py-0.5 font-mono pointer-coarse:min-h-8 pointer-coarse:min-w-8 text-[10.5px] hover:bg-[color-mix(in_oklab,var(--mark)_14%,transparent)] ${
            quiet ? "border-ink/10 text-muted hover:border-[color-mix(in_oklab,var(--mark)_35%,transparent)] hover:text-[var(--mark)]" : "border-[color-mix(in_oklab,var(--mark)_35%,transparent)] text-[var(--mark)]"
          }`}
        >
          P{priority}
        </button>
      ))}
    </div>
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
    setDays([...week]);
    setTime("");
    setAlarm("none");
    setOpen(false);
  };

  if (!open) return <AddButton onClick={() => setOpen(true)} />;

  return (
    <div onKeyDown={closeOnEscape(() => setOpen(false))} className={popoverClass}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Routine, e.g. meal prep" className={fieldClass} />
      <input value={cue} onChange={(e) => setCue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()} placeholder="If… (cue), e.g. it's 7pm Sunday" className={fieldClass} />
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
        <TimeField label="Time (optional)" optional value={time} onChange={setTime} className={`${fieldClass} w-32`} />
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
  if (!open) return <AddButton onClick={() => setOpen(true)} />;
  return <DeadlineFields deadline={null} act={act} model={model} onDone={() => setOpen(false)} />;
}

// A deadline's fields in a pop-over: a new one (due today, as of when it opens: the panel can stay
// mounted across days) or, with `deadline`, that one, of which only what changed is sent, so a field
// sent as it was can't win over a change made to it meanwhile on another device
function DeadlineFields({ deadline, act, model, onDone }: { deadline: Deadline | null; act: Act; model: GraphModel; onDone: () => void }) {
  const [title, setTitle] = useState(deadline?.title ?? "");
  const [dueDate, setDueDate] = useState(deadline?.dueDate ?? today());
  const [alarmTime, setAlarmTime] = useState(deadline?.alarmTime ?? "");
  const [nodeId, setNodeId] = useState(deadline?.nodeId ?? null);

  const submit = () => {
    if (!title.trim() || !dueDate) return;
    const fields = { title: title.trim(), dueDate, alarmTime: alarmTime || null, nodeId };
    if (!deadline) void act("createDeadline", { id: crypto.randomUUID(), ...fields });
    else {
      const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== deadline[key as keyof typeof fields]));
      if (Object.keys(changed).length > 0) void act("updateDeadline", deadline.id, changed);
    }
    onDone();
  };

  return (
    <div onKeyDown={closeOnEscape(onDone)} className={popoverClass}>
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()} placeholder="Deadline" className={fieldClass} />
      <div className="flex gap-2">
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldClass} />
        <TimeField label="Alarm on the day (optional)" optional value={alarmTime} onChange={setAlarmTime} className={`${fieldClass} w-32`} />
      </div>
      <NodePicker model={model} label="Deadline for" none="Not linked to a quest" value={nodeId} onChange={setNodeId} className={fieldClass} />
      <FormButtons onCancel={onDone} onSubmit={submit} submitLabel={deadline ? "Save" : "Add"} />
    </div>
  );
}

const fieldClass =
  "w-full rounded-lg border border-ink/10 bg-canvas/60 px-2.5 py-1.5 text-[13px] text-ink/85 placeholder:text-ink/35 focus:border-ember/50 focus:outline-none";
const popoverClass = "absolute right-0 top-8 z-10 w-72 space-y-2 rounded-xl border border-ink/10 bg-card p-3 shadow-[var(--card-shadow)]";
// A list row: quiet until hovered
const rowClass = "flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-ink/[0.04]";

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="relative mb-2 flex items-center justify-between px-1">
        <p className="caps font-display text-[11px] font-semibold text-ink/65">{title}</p>
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
    <button type="button" onClick={onClick} title="Add" className="flex h-6 w-6 items-center pointer-coarse:h-8 pointer-coarse:w-8 justify-center rounded-md text-base leading-none text-muted hover:bg-ink/8 hover:text-ink/85">
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

function FormButtons({ onCancel, onSubmit, submitLabel = "Add" }: { onCancel: () => void; onSubmit: () => void; submitLabel?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1 text-[12.5px]">
      <button type="button" onClick={onCancel} className="rounded-lg border border-ink/12 px-3 py-1 text-ink/70 hover:bg-ink/6">
        Cancel
      </button>
      <button type="button" onClick={onSubmit} className="rounded-lg bg-ember px-3 py-1 font-medium text-canvas hover:brightness-110">
        {submitLabel}
      </button>
    </div>
  );
}

