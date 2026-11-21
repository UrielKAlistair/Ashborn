import { useEffect, useRef, useState, type ReactNode } from "react";
import { readStored, writeStored } from "../../lib/storage";
import { keyNotForPage } from "../../lib/shortcuts";
import { paletteOf } from "../../lib/theme";
import { questOf, type GraphModel } from "../../shared/graphModel";
import { needsFirstStep, type Priorities } from "../../shared/priority";
import type { GraphNode } from "../../shared/types";
import type { Act } from "./HomePage";
import { showOnGraph } from "./showOnGraph";
import { Folding, useLeaving } from "./leaving";
import { Tick } from "./Tick";

// How many steps Now lists while folded
const NOW_ROWS = 3;

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

  // Rows ticked here fold away rather than vanish (leaving.tsx)
  const { leave, gone, withLeaving } = useLeaving(steps);
  const done = (row: GraphNode) => {
    void act("updateNode", row.id, { done: true });
    leave(row);
  };
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

  const rows = withLeaving(showAll ? steps : steps.slice(0, NOW_ROWS));
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

// A row just ticked: its tick filled and its title struck, as it folds away
function LeavingRow({ row, onGone }: { row: GraphNode; onGone: () => void }) {
  return (
    <Folding as="li" onGone={onGone} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
      <Tick done onClick={() => {}} className="tick-done mt-0.5" />
      <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink/50">
        <span className="line-through">{row.title}</span>
        {row.description ? <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted">{row.description}</span> : null}
      </span>
    </Folding>
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
