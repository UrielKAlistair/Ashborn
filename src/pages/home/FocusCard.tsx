import { useEffect, useRef, useState } from "react";
import { requestCapture } from "./Capture";
import { paletteOf } from "../../lib/theme";
import { daysBetween } from "../../shared/dates";
import { isDone, questOf, type GraphModel } from "../../shared/graphModel";
import type { Priorities } from "../../shared/priority";
import type { GraphNode, ISODate, Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";
import { SplitSteps } from "./SplitSteps";
import { showOnGraph } from "./showOnGraph";

// One step to do now: the most urgent ready one, with why it is here. Done ticks it; Not now
// passes to the next for this sitting; Split turns it into smaller steps.
export function FocusCard({ steps, priorities, snapshot, model, act, date }: {
  steps: GraphNode[]; // the to-do, most urgent first
  priorities: Priorities;
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
  date: ISODate;
}) {
  const [passed, setPassed] = useState<string[]>([]);
  const [splitting, setSplitting] = useState(false);
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

  if (steps.length === 0) {
    keys.current = { "/": requestCapture };
    return null;
  }

  // Passing every step starts the round again
  const waiting = steps.filter((step) => !passed.includes(step.id));
  const step = waiting[0] ?? steps[0];
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
  // The open step this one leads to, so a chain just split still shows its plan
  const then = snapshot.edges
    .filter(({ from }) => from === step.id)
    .map(({ to }) => model.byId.get(to))
    .find((next) => next && !isDone(next));

  const done = () => void act("updateNode", step.id, { done: true });
  const notNow = () => setPassed(waiting.length > 1 ? [...passed, step.id] : []);
  keys.current = splitting
    ? { "/": requestCapture }
    : { d: done, n: steps.length > 1 ? notNow : () => {}, s: () => setSplitting(true), "/": requestCapture };

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
          {quest.title}
          {parent ? ` · ${parent.title}` : ""}
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
        {then ? <li className="text-muted">Then: {then.title}</li> : null}
      </ul>

      {splitting ? (
        <SplitSteps act={act} parentId={step.id} onDone={() => setSplitting(false)} graph={{ model, snapshot }} className="mt-3 w-full" />
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
          <button type="button" onClick={done} title="Done (D)" className="rounded-lg bg-ember px-3.5 py-1.5 font-medium text-canvas hover:brightness-110">
            Done
          </button>
          {steps.length > 1 ? (
            <button
              type="button"
              onClick={notNow}
              title="Not now (N)"
              className="rounded-lg border border-ink/12 px-3 py-1.5 text-ink/75 hover:bg-ink/6"
            >
              Not now
            </button>
          ) : null}
          <button type="button" onClick={() => setSplitting(true)} title="Split it (S)" className="rounded-lg px-2 py-1.5 text-muted hover:bg-ink/6 hover:text-ink/85">
            Too big? Split it
          </button>
        </div>
      )}
    </section>
  );
}
