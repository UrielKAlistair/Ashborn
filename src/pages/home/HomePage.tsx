import { useMemo } from "react";
import type { Mutation } from "../../lib/api";
import { buildGraphModel } from "../../shared/graphModel";
import type { AshbornApi, Snapshot } from "../../shared/types";
import { CharacterPanel } from "./CharacterPanel";
import { QuestGraph } from "./LazyQuestGraph";
import { TodayPanel } from "./TodayPanel";

// Makes a change: shows it at once, sends it to the database (or, offline, queues it) and merges what
// comes back into the data on screen (App.tsx). Resolves to whether it was saved or queued; false when
// it was refused, with the reason shown.
export type Act = <K extends Mutation>(name: K, ...args: Parameters<AshbornApi[K]>) => Promise<boolean>;

type HomePageProps = {
  snapshot: Snapshot;
  act: Act;
};

// The desktop's Home: the quest graph, and beside it the character sheet and Today (Now, routines,
// deadlines). The phone shows the same parts one screen at a time (PhoneHome.tsx).
export function HomePage({ snapshot, act }: HomePageProps) {
  // The model reads only nodes and edges, so a routine, deadline or Kitchen change leaves it, and
  // everything the graph derives from it, as it was
  const model = useMemo(() => buildGraphModel(snapshot), [snapshot.nodes, snapshot.edges]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-5">
      <section className="panel-lift min-h-0 min-w-0 flex-[2] overflow-hidden rounded-2xl border border-ink/8 bg-panel">
        <QuestGraph snapshot={snapshot} model={model} act={act} phone={false} />
      </section>

      <div className="flex min-h-0 w-[30%] min-w-[20rem] max-w-[28rem] flex-col gap-5">
        <CharacterPanel model={model} />
        <TodayPanel snapshot={snapshot} model={model} act={act} />
      </div>
    </div>
  );
}
