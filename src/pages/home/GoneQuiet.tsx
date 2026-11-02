import { useState } from "react";
import { paletteOf } from "../../lib/theme";
import type { QuietQuest } from "../../shared/goneQuiet";
import { useOneTap } from "./oneTap";
import type { GraphModel } from "../../shared/graphModel";
import { priorities, type Snapshot } from "../../shared/types";
import type { Act } from "./HomePage";
import { SplitSteps } from "./SplitSteps";


// A folded list of quests nothing has touched for a while, each with what brings it back or puts it
// away. Any of them counts as touching it, so it leaves the list.
// `openAtFirst`: open from the start, when it is all Today has to offer
export function GoneQuiet({ quiet, snapshot, model, act, openAtFirst }: { quiet: QuietQuest[]; snapshot: Snapshot; model: GraphModel; act: Act; openAtFirst: boolean }) {
  const [open, setOpen] = useState(openAtFirst);
  const oneTap = useOneTap();
  if (quiet.length === 0) return null;
  return (
    <div className="-mt-3" role="group" aria-label="Gone quiet">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-1 text-[12.5px] text-muted hover:text-ink/85 pointer-coarse:min-h-8"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        Gone quiet <span className="font-mono tabular-nums">{quiet.length}</span>
      </button>
      {open ? (
        <div className="mt-1 space-y-1">
          {quiet.map((entry) => (
            <QuietRow key={entry.quest.id} entry={entry} snapshot={snapshot} model={model} act={act} oneTap={oneTap} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuietRow({ entry: { quest, days, openSteps }, snapshot, model, act, oneTap }: {
  entry: QuietQuest;
  snapshot: Snapshot;
  model: GraphModel;
  act: Act;
  oneTap: ReturnType<typeof useOneTap>;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="rounded-lg px-2 py-2 hover:bg-ink/[0.04]">
      <p className="text-[13px] leading-snug text-ink/80">{quest.title}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${paletteOf(quest.color).dot}`} />
        Quiet for {days} days · {openSteps === 1 ? "1 open step" : `${openSteps} open steps`}
      </p>
      {adding ? (
        <SplitSteps act={act} parentId={quest.id} onDone={() => setAdding(false)} graph={{ model, snapshot }} heading="Next steps" className="mt-2 w-full" />
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <div role="group" aria-label={`Priority for ${quest.title}`} className="flex gap-1">
            {priorities.map((priority) => (
              <button
                key={priority}
                type="button"
                data-priority={priority}
                onClick={oneTap(() => void act("updateNode", quest.id, { priority }))}
                title={`Priority ${priority}`}
                className="min-h-8 min-w-8 rounded-md border border-[color-mix(in_oklab,var(--mark)_35%,transparent)] px-1.5 font-mono text-[10.5px] text-[var(--mark)] hover:bg-[color-mix(in_oklab,var(--mark)_14%,transparent)]"
              >
                P{priority}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <button type="button" onClick={() => setAdding(true)} className="min-h-8 rounded-lg border border-ink/12 px-2.5 text-ink/75 hover:bg-ink/6">
            Add a next step
          </button>
          <button type="button" onClick={oneTap(() => void act("updateNode", quest.id, { shelved: true }))} className="min-h-8 rounded-lg px-2 text-muted hover:bg-ink/6 hover:text-ink/85">
            Shelve
          </button>
        </div>
      )}
    </div>
  );
}
