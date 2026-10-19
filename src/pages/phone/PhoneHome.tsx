import { useMemo, useState } from "react";
import type { Snapshot } from "../../shared/types";
import { buildGraphModel } from "../home/graphModel";
import type { Act } from "../home/HomePage";
import { ThreadGraph } from "../home/ThreadGraph";
import { TodayPanel } from "../home/TodayPanel";

// The phone's home: what to do today first; the graph one tap away, to look at more than to edit
export function PhoneHome({ snapshot, act }: { snapshot: Snapshot; act: Act }) {
  const model = useMemo(() => buildGraphModel(snapshot), [snapshot]);
  const [view, setView] = useState<"today" | "graph">("today");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex self-center rounded-full border border-white/10 bg-night-panel p-1 text-[11px] uppercase tracking-[0.2em]">
        {(["today", "graph"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setView(option)}
            className={`rounded-full px-5 py-1.5 ${view === option ? "bg-white/10 text-white" : "text-white/45"}`}
          >
            {option}
          </button>
        ))}
      </div>
      {view === "today" ? (
        <TodayPanel snapshot={snapshot} model={model} act={act} />
      ) : (
        <section className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-night-panel">
          <ThreadGraph snapshot={snapshot} model={model} act={act} phone />
        </section>
      )}
    </div>
  );
}
