import { useMemo } from "react";
import type { Mutation } from "../../lib/api";
import type { AshbornApi, Snapshot } from "../../shared/types";
import { CharacterPanel } from "./CharacterPanel";
import { buildGraphModel } from "./graphModel";
import { ThreadGraph } from "./ThreadGraph";
import { TodayPanel } from "./TodayPanel";

// Runs a change in the main process and merges what it returns into the data on screen
export type Act = <K extends Mutation>(name: K, ...args: Parameters<AshbornApi[K]>) => Promise<void>;

type HomePageProps = {
  snapshot: Snapshot;
  act: Act;
};

export function HomePage({ snapshot, act }: HomePageProps) {
  const model = useMemo(() => buildGraphModel(snapshot), [snapshot]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-5">
      <section className="min-h-0 min-w-0 flex-[2] overflow-hidden rounded-[28px] border border-white/12 bg-white/4 backdrop-blur-xl">
        <ThreadGraph snapshot={snapshot} model={model} act={act} />
      </section>

      <div className="flex min-h-0 w-[30%] min-w-[20rem] max-w-[28rem] flex-col gap-5">
        <CharacterPanel model={model} />
        <TodayPanel snapshot={snapshot} model={model} act={act} />
      </div>
    </div>
  );
}
