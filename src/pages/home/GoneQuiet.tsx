import { useState } from "react";
import { paletteOf } from "../../lib/theme";
import { readStored, writeStored } from "../../lib/storage";
import type { QuietQuest } from "../../shared/goneQuiet";
import { priorities } from "../../shared/types";
import type { Act } from "./HomePage";
import { useOneTap } from "./oneTap";
import { showOnGraph } from "./showOnGraph";

// How many quiet quests show while folded
const QUIET_ROWS = 3;

// The quests nothing has touched for a while, at the top of Today, each asking what's up: show it on
// the graph to act on it, change its priority, or shelve it. Acting on it inside takes it off the
// list; a priority changed keeps it here only while it is still past its threshold.
export function GoneQuiet({ quiet, act }: { quiet: QuietQuest[]; act: Act }) {
  const [showAll, setShowAllState] = useState(() => Boolean(readStored<boolean>(showAllStorageKey, false)));
  const setShowAll = (show: boolean) => {
    setShowAllState(show);
    writeStored(showAllStorageKey, show);
  };
  const oneTap = useOneTap();
  if (quiet.length === 0) return null;
  const rows = showAll ? quiet : quiet.slice(0, QUIET_ROWS);
  return (
    <section aria-label="Gone quiet" className="rounded-xl border border-ember/35 bg-card px-2 py-2.5">
      <div className="flex items-baseline justify-between px-2">
        <p className="caps font-display text-[11px] font-bold text-ember">
          Gone quiet <span className="font-mono tabular-nums">{quiet.length}</span>
        </p>
        {quiet.length > QUIET_ROWS ? (
          <button type="button" onClick={() => setShowAll(!showAll)} className="text-[11.5px] text-muted hover:text-ink/85 pointer-coarse:min-h-8">
            {showAll ? "Show fewer" : `Show all ${quiet.length}`}
          </button>
        ) : null}
      </div>
      <p className="px-2 pb-1 text-[12px] text-muted">Nothing done on these lately. What's up?</p>
      <ul className="space-y-0.5">
        {rows.map((entry) => (
          <QuietRow key={entry.quest.id} entry={entry} act={act} oneTap={oneTap} />
        ))}
      </ul>
    </section>
  );
}

function QuietRow({ entry: { quest, days, openSteps, priority }, act, oneTap }: { entry: QuietQuest; act: Act; oneTap: ReturnType<typeof useOneTap> }) {
  return (
    <li className="rounded-lg px-2 py-1.5 hover:bg-ink/[0.04]">
      <button
        type="button"
        onClick={() => showOnGraph(quest.id)}
        title="Show on the graph"
        className="text-left text-[13px] leading-snug text-ink/90 decoration-ember/50 underline-offset-4 hover:underline"
      >
        {quest.title}
      </button>
      <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(priority).dot}`} />
        {priority ? `P${priority} · ` : ""}Quiet for {days} days · {openSteps === 1 ? "1 open step" : `${openSteps} open steps`}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <div role="group" aria-label={`Priority for ${quest.title}`} className="flex gap-1">
          {priorities.map((level) => (
            <button
              key={level}
              type="button"
              data-priority={level}
              aria-pressed={quest.priority === level}
              onClick={oneTap(() => void act("updateNode", quest.id, { priority: level }))}
              title={`Priority ${level}`}
              className="min-h-8 min-w-8 rounded-md border border-[color-mix(in_oklab,var(--mark)_35%,transparent)] px-1.5 font-mono text-[10.5px] text-[var(--mark)] hover:bg-[color-mix(in_oklab,var(--mark)_14%,transparent)] aria-pressed:bg-[color-mix(in_oklab,var(--mark)_22%,transparent)]"
            >
              P{level}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={() => showOnGraph(quest.id)} className="min-h-8 rounded-lg border border-ink/12 px-2.5 text-ink/75 hover:bg-ink/6">
          Show on graph
        </button>
        <button type="button" onClick={oneTap(() => void act("updateNode", quest.id, { shelved: true }))} className="min-h-8 rounded-lg px-2 text-muted hover:bg-ink/6 hover:text-ink/85">
          Shelve
        </button>
      </div>
    </li>
  );
}

// Whether Gone quiet lists every quiet quest, kept on this device
const showAllStorageKey = "ashborn-show-all-quiet";
