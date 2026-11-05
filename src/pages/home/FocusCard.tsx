import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { requestCapture } from "./Capture";
import { paletteOf } from "../../lib/theme";
import { questOf, type GraphModel } from "../../shared/graphModel";
import { needsFirstStep, type Priorities } from "../../shared/priority";
import type { GraphNode, ISODate, Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";
import { chooseNow } from "../../shared/nowStep";
import { MORE_MINUTES, setHolding, setSplitFrom, START_MINUTES, storePassed, storeTimer, timerBox, useNowMemory } from "./nowStore";
import { SplitSteps } from "./SplitSteps";
import { showOnGraph } from "./showOnGraph";
import { Tick } from "./Tick";

// How many steps Now lists while folded
const NOW_ROWS = 3;

// The to-do as one list: the step chooseNow picks, then the rest in the to-do's order, the ones put off
// today last. It shows the first few until unfolded. Each row has its tick, its title, its quest's dot
// and a ⋯ menu with Start (a 15-minute box), Not now (to the end of the list for the day) and Split it.
// While a started step's time runs, or Split is open on one, Now holds that step alone.
export function FocusCard({ steps, priorities, snapshot, model, act, date, empty, onBoxed }: {
  steps: GraphNode[]; // the to-do, most urgent first
  priorities: Priorities;
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
  date: ISODate;
  empty: ReactNode; // what shows when nothing is ready
  onBoxed?: (boxed: boolean) => void; // hears whether a started step's timer is running, so the panel can fold the rest
}) {
  const memory = useNowMemory(date);
  const [showAll, setShowAllState] = useState(loadShowAll);
  const setShowAll = (show: boolean) => {
    setShowAllState(show);
    saveShowAll(show);
  };
  const [clock, setClock] = useState(Date.now);
  const choice = chooseNow(steps, memory, clock, date);
  const timer = memory.timer;
  // The keys act on the first row, whichever render set them up
  const keys = useRef<Record<string, () => void>>({});

  // On the desktop: D done, T start or stop, N not now, S split, / the capture field; never while typing in a field
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

  // Split holds Now only while it is on screen: left open on a screen that's gone, it would hide what's next
  useEffect(() => () => setHolding(null), []);

  const boxed = Boolean(choice?.timed && choice.timed.endsAt > clock);
  useEffect(() => {
    onBoxed?.(boxed);
    return () => onBoxed?.(false);
  }, [boxed, onBoxed]);

  // A running timer ticks each second until it ends (the app says when, see useTimeUpNotice)
  useEffect(() => {
    setClock(Date.now());
    if (!timer || timer.endsAt <= Date.now()) return;
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    const end = window.setTimeout(() => {
      window.clearInterval(tick);
      setClock(Date.now());
    }, timer.endsAt - Date.now());
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [timer?.endsAt]);

  if (!choice) {
    keys.current = { "/": requestCapture };
    return (
      <section aria-label="Now" className="rounded-xl border border-ink/10 bg-card px-2 py-2.5">
        <p className="caps px-2 pb-1 font-display text-[11px] font-bold text-ember">Now</p>
        {empty}
      </section>
    );
  }

  const { step, timed } = choice;
  const splitting = memory.holding === step.id;
  const waiting = steps.filter(({ id }) => !choice.passed.includes(id));
  const putOff = choice.passed.flatMap((id) => steps.filter((row) => row.id === id));
  const ordered = [step, ...waiting, ...putOff].filter((row, index, all) => all.findIndex(({ id }) => id === row.id) === index);
  const rows = timed || splitting ? [step] : showAll ? ordered : ordered.slice(0, NOW_ROWS);
  const folds = !timed && !splitting && ordered.length > NOW_ROWS;
  const timeLeft = timed ? Math.max(0, timed.endsAt - clock) : null;

  const done = (row: GraphNode) => {
    if (timed?.stepId === row.id) storeTimer(null);
    void act("updateNode", row.id, { done: true });
  };
  const start = (row: GraphNode) => storeTimer(timerBox(row.id, START_MINUTES));
  const more = () => storeTimer(timerBox(step.id, MORE_MINUTES));
  const stop = () => storeTimer(null);
  // Putting off the last of the round starts it again
  const notNow = (row: GraphNode) => storePassed(date, waiting.length > 1 ? [...choice.passed, row.id] : []);
  const split = (row: GraphNode) => setHolding(row.id);
  const canPass = steps.length > 1 && !timed;
  keys.current = splitting
    ? { "/": requestCapture }
    : needsFirstStep(model, step)
      ? { n: canPass ? () => notNow(step) : () => {}, s: () => split(step), "/": requestCapture }
      : { d: () => done(step), t: timed ? stop : () => start(step), n: canPass ? () => notNow(step) : () => {}, s: () => split(step), "/": requestCapture };

  return (
    <section aria-label="Now" className="rounded-xl border border-ink/10 bg-card px-2 py-2.5">
      <div className="flex items-baseline justify-between px-2 pb-1">
        <p className="caps font-display text-[11px] font-bold text-ember">Now</p>
        {folds ? (
          <button type="button" onClick={() => setShowAll(!showAll)} className="text-[11.5px] text-muted hover:text-ink/85 pointer-coarse:min-h-8">
            {showAll ? "Show fewer" : `Show all ${ordered.length} ready`}
          </button>
        ) : null}
      </div>
      <ul aria-label="Now" className="space-y-0.5">
        {rows.map((row) => {
          const firstStep = needsFirstStep(model, row);
          const quest = questOf(model.byId, row);
          return (
            <li key={row.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink/[0.04]">
              {firstStep ? (
                <button
                  type="button"
                  onClick={() => split(row)}
                  title="Add a first step"
                  aria-label="Add a first step"
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-dashed border-ink/35 text-[11px] leading-none text-muted hover:border-ember hover:text-ember"
                >
                  +
                </button>
              ) : (
                <Tick done={false} onClick={() => done(row)} className="mt-0.5" />
              )}
              <button
                type="button"
                onClick={() => showOnGraph(row.id)}
                title="Show on the graph"
                className="min-w-0 flex-1 text-left text-[13px] leading-snug text-ink/90 decoration-ember/50 underline-offset-4 hover:underline"
              >
                {row.title}
              </button>
              <span title={quest.title} className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(priorities.best.get(quest.id)).dot}`} />
              <RowMenu
                title={row.title}
                items={[
                  ...(firstStep || timed ? [] : [{ label: `Start (${START_MINUTES} min)`, onClick: () => start(row) }]),
                  ...(canPass && !choice.passed.includes(row.id) ? [{ label: "Not now", onClick: () => notNow(row) }] : []),
                  ...(splitting ? [] : [{ label: firstStep ? "Add first steps" : "Split it", onClick: () => split(row) }]),
                ]}
              />
            </li>
          );
        })}
      </ul>

      {timed && timeLeft !== null && !splitting ? (
        <div className="mt-1 px-2">
          {timeLeft > 0 ? (
            <div className="flex items-center gap-3" role="timer" aria-label="Time left">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
                <div className="h-full rounded-full bg-ember" style={{ width: `${(100 * timeLeft) / (timed.endsAt - timed.startedAt)}%` }} />
              </div>
              <span className="font-mono text-[12px] text-ink/80 tabular-nums">
                {Math.floor(timeLeft / 60_000)}:{String(Math.floor(timeLeft / 1000) % 60).padStart(2, "0")}
              </span>
            </div>
          ) : (
            <p className="text-[13px] font-medium text-ink/90">Time's up. Done, or keep going?</p>
          )}
          <div className="mt-2 flex items-center gap-2 text-[12.5px]">
            {timeLeft === 0 ? (
              <button type="button" onClick={more} className="rounded-lg border border-ink/12 px-2.5 py-1 text-ink/75 hover:bg-ink/6">
                {MORE_MINUTES} more minutes
              </button>
            ) : null}
            <button type="button" onClick={stop} title="Stop the timer (T)" className="rounded-lg px-2 py-1 text-muted hover:bg-ink/6 hover:text-ink/85">
              Stop
            </button>
          </div>
        </div>
      ) : null}

      {splitting ? (
        <SplitSteps
          act={act}
          parentId={step.id}
          onAdded={() => setSplitFrom(step.id)}
          onDone={() => setHolding(null)}
          graph={{ model, snapshot }}
          heading={needsFirstStep(model, step) ? "First steps" : undefined}
          className="mt-2 w-full"
        />
      ) : null}
    </section>
  );
}

// A row's ⋯ menu; it closes on a choice, on Escape and when focus leaves it
function RowMenu({ title, items }: { title: string; items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return <span className="w-6 shrink-0" />;
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };

  return (
    <div
      onBlur={leave}
      onKeyDown={(event) => {
        // Escape closes an open menu before the navbar's hide-to-tray handler sees it
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        setOpen(false);
      }}
      className="relative shrink-0"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={`Actions for ${title}`}
        aria-expanded={open}
        className="flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-muted hover:bg-ink/8 hover:text-ink/85 pointer-coarse:h-8 pointer-coarse:w-8"
      >
        ⋯
      </button>
      {open ? (
        <div role="menu" aria-label={`Actions for ${title}`} className="absolute right-0 top-7 z-10 w-40 rounded-lg border border-ink/10 bg-card p-1 shadow-[var(--card-shadow)]">
          {items.map(({ label, onClick }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onClick();
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink/85 hover:bg-ink/6 pointer-coarse:min-h-10"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Whether Now lists the whole to-do, kept on this device
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
