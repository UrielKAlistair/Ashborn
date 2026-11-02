import { useEffect, useRef, useState } from "react";
import { usePhone } from "../../lib/usePhone";
import { requestCapture } from "./Capture";
import { paletteOf } from "../../lib/theme";
import { daysBetween } from "../../shared/dates";
import { isDone, questOf, type GraphModel } from "../../shared/graphModel";
import { needsFirstStep, type Priorities } from "../../shared/priority";
import type { GraphNode, ISODate, Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";
import { passedOver, storePassedOver, storedTimer, storeTimer, type StartTimer } from "./nowStore";
import { SplitSteps } from "./SplitSteps";
import { showOnGraph } from "./showOnGraph";
import { useNowMirror } from "./nowMirror";

// A started step's time box, and on how many days a step can be passed over before Now asks why
const START_MINUTES = 15;
const MORE_MINUTES = 5;
const PASSED_OVER_ASKS = 3;

// One step to do now: the most urgent ready one, with why it is here. Done ticks it; Start boxes
// it into 15 minutes; Not now passes to the next for this sitting; Split turns it into smaller steps.
export function FocusCard({ steps, priorities, snapshot, model, act, date, onBoxed }: {
  steps: GraphNode[]; // the to-do, most urgent first
  priorities: Priorities;
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
  date: ISODate;
  onBoxed?: (boxed: boolean) => void; // hears whether a started step's timer is running, so the panel can fold the rest
}) {
  const [passed, setPassed] = useState<string[]>([]);
  const [splitting, setSplitting] = useState(false);
  // The step last split here: its new steps come up next, ahead of the to-do's order
  const [splitFrom, setSplitFrom] = useState<string | null>(null);
  const [counts, setCounts] = useState(passedOver);
  const [timer, setTimer] = useState(storedTimer);
  const [clock, setClock] = useState(Date.now);
  const phone = usePhone();
  const mirror = useNowMirror();
  // The notice at the end reads the steps as they are then
  const latestSteps = useRef(steps);
  latestSteps.current = steps;
  // The keys act on the step shown now, whichever render set them up
  const keys = useRef<Record<string, () => void>>({});

  // On the desktop: D done, N not now, S split, / the capture field; never while typing in a field
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
      const action = keys.current[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const boxed = Boolean(timer && timer.endsAt > clock && steps.some(({ id }) => id === timer.stepId));
  useEffect(() => {
    onBoxed?.(boxed);
    return () => onBoxed?.(false);
  }, [boxed, onBoxed]);

  // A running timer ticks each second, and says so when it ends, even with the window hidden
  useEffect(() => {
    if (!timer) return;
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    // A timer that ended before this card mounted has had its notice
    if (timer.endsAt <= Date.now()) return () => window.clearInterval(tick);
    const end = window.setTimeout(() => {
      const step = latestSteps.current.find(({ id }) => id === timer.stepId);
      if (step && "Notification" in window && Notification.permission === "granted") new Notification(`Time's up: ${step.title}`, { body: "Done, or keep going?" });
    }, timer.endsAt - Date.now());
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [timer]);

  if (steps.length === 0) {
    keys.current = { "/": requestCapture };
    mirror.current = null;
    return null;
  }

  // A started step holds Now; otherwise passing every step starts the round again
  const timed = timer ? steps.find(({ id }) => id === timer.stepId) : undefined;
  const waiting = steps.filter((step) => !passed.includes(step.id));
  const step = timed ?? waiting.find(({ parentId }) => parentId === splitFrom) ?? waiting[0] ?? steps[0];
  const priority = priorities.effective.get(step.id);
  const origin = priorities.origin.get(step.id);
  const quest = questOf(model.byId, step);
  const parent = step.parentId && step.parentId !== quest.id ? model.byId.get(step.parentId) : null;
  const from = origin && origin.nodeId !== step.id ? model.byId.get(origin.nodeId) : null;
  // The priority came down from a box the step sits in, or back along links from a step it leads to
  let within = false;
  for (let at = step.parentId; at && !within; at = model.byId.get(at)?.parentId ?? null) within = at === from?.id;
  // The deadline that raised it, else the nearest one linked to the step or to what it leads to:
  // a deadline can tie with the user's own priority and lose the walk, but still matters here
  const deadline =
    snapshot.deadlines.find(({ id }) => id === origin?.deadlineId) ??
    snapshot.deadlines
      .filter(({ nodeId }) => nodeId && (nodeId === step.id || nodeId === origin?.nodeId))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ??
    null;
  const daysLeft = deadline ? daysBetween(date, deadline.dueDate) : null;
  // The open step this one leads to, so a chain just split still shows its plan; unless "Leads to" names it
  const then = snapshot.edges
    .filter(({ from }) => from === step.id)
    .map(({ to }) => model.byId.get(to))
    .find((next) => next && !isDone(next));

  const setTimed = (next: StartTimer | null) => {
    storeTimer(next);
    setTimer(next);
    setClock(Date.now());
  };
  // Once a day at most, so looking through the steps in one sitting isn't counted as avoiding one
  const passedToday = counts[step.id]?.last === date;
  const setPassedDays = (days: number) => {
    const { [step.id]: _, ...rest } = counts;
    const next = days ? { ...rest, [step.id]: { days, last: date } } : rest;
    storePassedOver(next);
    setCounts(next);
  };
  const running = timed && timer ? timer : null;
  const timeLeft = running ? Math.max(0, running.endsAt - clock) : null;
  const passedDays = counts[step.id]?.days ?? 0;

  const done = () => {
    if (timed) setTimed(null);
    if (passedDays) setPassedDays(0);
    void act("updateNode", step.id, { done: true });
  };
  const box = (minutes: number) => setTimed({ stepId: step.id, startedAt: Date.now(), endsAt: Date.now() + minutes * 60_000 });
  const start = () => box(START_MINUTES);
  const more = () => box(MORE_MINUTES);
  const stop = () => setTimed(null);
  const notNow = () => {
    if (!passedToday) setPassedDays(passedDays + 1);
    setPassed(waiting.length > 1 ? [...passed, step.id] : []);
  };
  const firstStep = needsFirstStep(model, step);
  mirror.current = { id: step.id, title: step.title, endsAt: running?.endsAt ?? null, canTick: !firstStep };
  keys.current = splitting
    ? { "/": requestCapture }
    : firstStep
      ? { n: steps.length > 1 ? notNow : () => {}, s: () => setSplitting(true), "/": requestCapture }
      : { d: done, t: timed ? stop : start, n: steps.length > 1 && !timed ? notNow : () => {}, s: () => setSplitting(true), "/": requestCapture };

  return (
    <section data-priority={priority} aria-label="Now" className="rounded-xl border border-[color-mix(in_oklab,var(--mark)_40%,transparent)] bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="font-display text-[13px] font-semibold text-ember">Now</span>
        <span className="rounded-md bg-[color-mix(in_oklab,var(--mark)_15%,transparent)] px-1.5 font-mono text-[11px] font-semibold text-[var(--mark)]">P{priority}</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {steps.indexOf(step) + 1} of {steps.length}
        </span>
      </div>

      <button
        type="button"
        onClick={() => showOnGraph(step.id)}
        title="Show on the graph"
        className="mt-2 block text-left font-display text-[17px] leading-snug font-semibold text-ink/95 decoration-ember/50 underline-offset-4 hover:underline"
      >
        {step.title}
      </button>
      <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(quest.color).dot}`} />
        <span className="truncate">
          {firstStep ? "A quest with no steps yet" : (
            <>
              {quest.title}
              {parent ? ` · ${parent.title}` : ""}
            </>
          )}
        </span>
      </p>

      <ul className="mt-3 space-y-1 text-[12.5px] text-ink/75">
        {from && within ? (
          <li>→ Part of {from.title}, which has this priority</li>
        ) : from ? (
          <li>→ Leads to {from.title}</li>
        ) : step.priority ? (
          <li>→ You gave it this priority</li>
        ) : null}
        {deadline && daysLeft !== null ? (
          <li className={daysLeft <= 2 ? "text-amber-200" : ""}>
            ◷ {deadline.title}, {daysLeft < 0 ? `${-daysLeft}d late` : daysLeft === 0 ? "due today" : `due in ${daysLeft}d`}
          </li>
        ) : null}
        {then && then.id !== from?.id ? <li className="text-muted">Then: {then.title}</li> : null}
        {passedDays >= PASSED_OVER_ASKS && !firstStep ? (
          <li className="text-amber-200">↷ Passed over on {passedDays} days. Too big, or waiting on something?</li>
        ) : null}
      </ul>

      {running && timeLeft !== null && !splitting ? (
        timeLeft > 0 ? (
          <div className="mt-3 flex items-center gap-3" role="timer" aria-label="Time left">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
              <div className="h-full rounded-full bg-ember" style={{ width: `${(100 * timeLeft) / (running.endsAt - running.startedAt)}%` }} />
            </div>
            <span className="font-mono text-[12px] text-ink/80 tabular-nums">
              {Math.floor(timeLeft / 60_000)}:{String(Math.floor(timeLeft / 1000) % 60).padStart(2, "0")}
            </span>
          </div>
        ) : (
          <p className="mt-3 text-[13px] font-medium text-ink/90">Time's up. Done, or keep going?</p>
        )
      ) : null}

      {splitting ? (
        <SplitSteps act={act} parentId={step.id} onAdded={() => {
            setPassedDays(0);
            setSplitFrom(step.id);
          }} onDone={() => setSplitting(false)} graph={{ model, snapshot }} heading={firstStep ? "First steps" : undefined} className="mt-3 w-full" />
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          {firstStep ? (
            <button type="button" onClick={() => setSplitting(true)} title="Add a first step (S)" className="rounded-lg bg-ember px-3.5 py-1.5 font-medium text-canvas hover:brightness-110">
              Add a first step
            </button>
          ) : (
            <button type="button" onClick={done} title="Done (D)" className="rounded-lg bg-ember px-3.5 py-1.5 font-medium text-canvas hover:brightness-110">
              Done
            </button>
          )}
          {timed ? (
            <>
              {timeLeft === 0 ? (
                <button type="button" onClick={more} className="rounded-lg border border-ink/12 px-3 py-1.5 text-ink/75 hover:bg-ink/6">
                  {MORE_MINUTES} more minutes
                </button>
              ) : null}
              <button type="button" onClick={stop} title="Stop the timer (T)" className="rounded-lg px-2 py-1.5 text-muted hover:bg-ink/6 hover:text-ink/85">
                Stop
              </button>
            </>
          ) : firstStep ? null : (
            <button type="button" onClick={start} title={`Start: ${START_MINUTES} minutes on it (T)`} className="rounded-lg border border-ink/12 px-3 py-1.5 text-ink/75 hover:bg-ink/6">
              Start
            </button>
          )}
          {steps.length > 1 && !timed ? (
            <button
              type="button"
              onClick={notNow}
              title="Not now (N)"
              className="rounded-lg border border-ink/12 px-3 py-1.5 text-ink/75 hover:bg-ink/6"
            >
              Not now
            </button>
          ) : null}
          {firstStep ? null : (
            <button
              type="button"
              onClick={() => setSplitting(true)}
              title="Split it (S)"
              className={`rounded-lg px-2 py-1.5 hover:bg-ink/6 ${passedDays >= PASSED_OVER_ASKS ? "border border-amber-300/50 text-ink/85" : "text-muted hover:text-ink/85"}`}
            >
              {phone ? "Split it" : "Too big? Split it"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
