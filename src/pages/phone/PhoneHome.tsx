import { useMemo } from "react";
import { buildGraphModel } from "../../shared/graphModel";
import type { Snapshot } from "../../shared/types";
import { CharacterPanel } from "../home/CharacterPanel";
import type { Act } from "../home/HomePage";
import { ThreadGraph } from "../home/ThreadGraph";
import { TodayPanel } from "../home/TodayPanel";

export type PhoneHomeScreen = "todo" | "graph" | "character";

// The phone's Home section, one screen at a time: what to do today, the graph (to look at more
// than to edit), and the character
export function PhoneHome({ snapshot, act, screen }: { snapshot: Snapshot; act: Act; screen: PhoneHomeScreen }) {
  const model = useMemo(() => buildGraphModel(snapshot), [snapshot]);

  if (screen === "graph") {
    return (
      <section className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-night-panel">
        <ThreadGraph snapshot={snapshot} model={model} act={act} phone />
      </section>
    );
  }

  if (screen === "character") {
    return (
      <div className="panel-scroll flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto">
        <CharacterPanel model={model} card />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TodayPanel snapshot={snapshot} model={model} act={act} />
    </div>
  );
}
