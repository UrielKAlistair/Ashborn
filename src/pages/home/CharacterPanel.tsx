import { palettes } from "../../lib/theme";
import { statLevel } from "../../shared/progression";
import type { StatKey, ThreadColor } from "../../shared/types";
import { statKeys, type GraphModel } from "./graphModel";
import { Portrait, portraitTiers } from "./Portrait";

// The portrait advances one sprite tier every PORTRAIT_TIER_LEVELS overall levels
const PORTRAIT_TIER_LEVELS = 5;
// Each stat's bar has a colour of its own, unrelated to the colours of threads
const statColors: Record<StatKey, ThreadColor> = { STR: "red", DEX: "orange", INT: "blue", WIS: "green", CHR: "violet", MND: "teal" };

export function CharacterPanel({ model }: { model: GraphModel }) {
  const overall = statLevel(model.totalStatXp);
  const tier = Math.min(portraitTiers, Math.floor((overall.level - 1) / PORTRAIT_TIER_LEVELS) + 1);

  return (
    <section className="shrink-0 rounded-3xl border border-white/10 bg-night-panel p-4">
      <div className="flex gap-8">
        <div className="ml-3 flex w-24 shrink-0 flex-col items-center">
          <div className="flex w-24 items-end justify-center">
            <Portrait tier={tier} />
          </div>
          <p className="mt-3 text-[10px] uppercase tracking-[0.22em] text-white/55">Lv {overall.level}</p>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-night/50">
            <div className="h-full rounded-full bg-[#d7c17d]" style={{ width: `${overall.percent}%` }} />
          </div>
        </div>

        <dl className="grid min-w-0 flex-1 grid-cols-2 content-center gap-x-3 gap-y-2">
          {statKeys.map((key) => {
            const { level, percent } = statLevel(model.statXp[key]);
            return (
              <div key={key} title={`${model.statXp[key]} xp`}>
                <div className="flex items-baseline justify-between">
                  <dt className="text-[11px] tracking-[0.18em] text-white/55">{key}</dt>
                  <dd className="text-sm text-white/90">{level}</dd>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full border border-white/8 bg-night/50">
                  <div className={`h-full rounded-full ${palettes[statColors[key]].bar}`} style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
