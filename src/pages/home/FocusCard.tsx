import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { readStored, writeStored } from "../../lib/storage";
import { keyNotForPage } from "../../lib/shortcuts";
import { paletteOf } from "../../lib/theme";
import { questOf, type GraphModel } from "../../shared/graphModel";
import { needsFirstStep, type Priorities } from "../../shared/priority";
import type { GraphNode } from "../../shared/types";
import type { Act } from "./HomePage";
import { showOnGraph } from "./showOnGraph";
import { Tick } from "./Tick";

// How many steps Now lists while folded
const NOW_ROWS = 3;
// A row ticked here shows its filled tick, then folds away; the first share of the time is the hold
const LEAVE_MS = 200;
const LEAVE_HOLD = 0.4;

// The to-do as one list, most urgent first; its first step is the one in Now (mirrored to the tray and
// the graph, nowMirror.ts). It shows the first few until unfolded. Each row has its tick, its title
// (a click shows it on the graph) and its quest's dot; an empty quest has a + in place of the tick,
// which shows it on the graph to be given its first steps.
export function FocusCard({ steps, priorities, model, act, empty }: {
  steps: GraphNode[]; // the to-do, most urgent first
  priorities: Priorities;
  model: GraphModel;
  act: Act;
  empty: ReactNode; // what shows when nothing is ready
}) {
  const [showAll, setShowAllState] = useState(loadShowAll);
  const setShowAll = (show: boolean) => {
    setShowAllState(show);
    saveShowAll(show);
  };
  // D ticks the first row, whichever render set it up
  const tickFirst = useRef<(() => void) | null>(null);

  // On the desktop: D done; never while typing in a field or with a dialog open
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (keyNotForPage(event) || event.key.toLowerCase() !== "d" || !tickFirst.current) return;
      event.preventDefault();
      tickFirst.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Rows ticked here, drawn where they were until they have folded away; the change is sent at once
  const [leaving, setLeaving] = useState<{ row: GraphNode; index: number }[]>([]);
  const done = (row: GraphNode) => {
    void act("updateNode", row.id, { done: true });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setLeaving((current) => [...current.filter((leaver) => leaver.row.id !== row.id), { row, index: steps.indexOf(row) }]);
  };
  const gone = (row: GraphNode) => setLeaving((current) => current.filter((leaver) => leaver.row !== row));
  const first = steps[0];
  tickFirst.current = first && !needsFirstStep(model, first) ? () => done(first) : null;

  if (!first) {
    return (
      <section aria-label="Now" className="rounded-xl border border-ink/10 bg-card px-2 py-2.5">
        <p className="caps px-2 pb-1 font-display text-[11px] font-bold text-ember">Now</p>
        {empty}
      </section>
    );
  }

  const rows: Array<GraphNode | { leaving: GraphNode }> = showAll ? [...steps] : steps.slice(0, NOW_ROWS);
  // A row undone before it has folded is back in the list, and drawn there alone
  for (const { row, index } of [...leaving].sort((a, b) => a.index - b.index)) {
    if (!steps.some((step) => step.id === row.id) && index <= rows.length) rows.splice(index, 0, { leaving: row });
  }
  return (
    <section aria-label="Now" className="rounded-xl border border-ink/10 bg-card px-2 py-2.5">
      <div className="flex items-baseline justify-between px-2 pb-1">
        <p className="caps font-display text-[11px] font-bold text-ember">Now</p>
        {steps.length > NOW_ROWS ? (
          <button type="button" onClick={() => setShowAll(!showAll)} className="text-[11.5px] text-muted hover:text-ink/85 pointer-coarse:min-h-8">
            {showAll ? "Show fewer" : `Show all ${steps.length} ready`}
          </button>
        ) : null}
      </div>
      <ul aria-label="Now" className="space-y-0.5">
        {rows.map((row) => {
          if ("leaving" in row) return <LeavingRow key={`leaving:${row.leaving.id}`} row={row.leaving} onGone={() => gone(row.leaving)} />;
          const quest = questOf(model.byId, row);
          return (
            <li key={row.id} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-ink/[0.04]">
              {needsFirstStep(model, row) ? (
                <button
                  type="button"
                  onClick={() => showOnGraph(row.id)}
                  title="Add its first steps on the graph"
                  aria-label="Add its first steps on the graph"
                  className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-dashed pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-[''] border-ink/35 text-[11px] leading-none text-muted hover:border-ember hover:text-ember"
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
                {row.description ? <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted no-underline">{row.description}</span> : null}
              </button>
              <span title={quest.title} className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(priorities.best.get(quest.id)).dot}`} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// A row just ticked: its tick filled, then the row folds to nothing, so the rows below close up
// rather than jump. Not a button any more: a second tap can't untick it.
function LeavingRow({ row, onGone }: { row: GraphNode; onGone: () => void }) {
  const box = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const height = `${box.current!.offsetHeight}px`;
    const shown = { height, opacity: 1 };
    const animation = box.current!.animate([{ ...shown, offset: 0 }, { ...shown, offset: LEAVE_HOLD }, { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", marginTop: "0px" }], { duration: LEAVE_MS, easing: "ease-in", fill: "forwards" });
    animation.onfinish = onGone;
    return () => animation.cancel();
  }, []);
  return (
    <li ref={box} aria-hidden className="pointer-events-none flex items-start gap-2.5 overflow-hidden rounded-lg px-2 py-1.5">
      <span className="tick-done mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-canvas">
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.2 L5 8.5 L9.5 3.5" />
        </svg>
      </span>
      <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink/50">
        <span className="line-through">{row.title}</span>
        {row.description ? <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted">{row.description}</span> : null}
      </span>
    </li>
  );
}

// Whether Now lists the whole to-do, kept on this device
const showAllStorageKey = "ashborn-show-all-todo";

function loadShowAll() {
  return Boolean(readStored<boolean | number>(showAllStorageKey, false));
}

function saveShowAll(show: boolean) {
  writeStored(showAllStorageKey, show);
}
