import { palettes } from "../../lib/theme";
import { statKeys, type GraphModel } from "../../shared/graphModel";
import { statLevel } from "../../shared/progression";
import type { QuestColor, StatKey } from "../../shared/types";
import { Portrait, portraitTiers } from "./Portrait";

// The portrait advances one sprite tier every PORTRAIT_TIER_LEVELS overall levels
const PORTRAIT_TIER_LEVELS = 5;
// How much larger the portrait is drawn on the phone's character card
const CARD_PORTRAIT_ZOOM = 2;
// Each stat's bar has a colour of its own, unrelated to the colours of quests
const statColors: Record<StatKey, QuestColor> = { STR: "red", DEX: "orange", INT: "blue", WIS: "green", CHR: "violet", MND: "teal" };

// The character: portrait, overall level and the six stats. On the desktop a row beside the
// to-do list; on the phone (`card`) a tall card with a larger portrait and the stats beneath it.
export function CharacterPanel({ model, card = false }: { model: GraphModel; card?: boolean }) {
  const overall = statLevel(model.totalStatXp);
  const tier = Math.min(portraitTiers, Math.floor((overall.level - 1) / PORTRAIT_TIER_LEVELS) + 1);

  const portrait = (
    <div className={`flex shrink-0 flex-col items-center ${card ? "w-48" : "ml-3 w-24"}`}>
      <div className={`flex items-end justify-center ${card ? "w-48" : "w-24"}`}>
        <Portrait tier={tier} zoom={card ? CARD_PORTRAIT_ZOOM : 1} />
      </div>
      <p className={`mt-3 uppercase tracking-[0.22em] text-white/55 ${card ? "text-xs" : "text-[10px]"}`}>Lv {overall.level}</p>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-night/50">
        <div className="h-full rounded-full bg-[#d7c17d]" style={{ width: `${overall.percent}%` }} />
      </div>
    </div>
  );

  const stats = (
    <dl className={`grid min-w-0 grid-cols-2 content-center ${card ? "w-full gap-x-6 gap-y-4" : "flex-1 gap-x-3 gap-y-2"}`}>
      {statKeys.map((key) => {
        const { level, percent } = statLevel(model.statXp[key]);
        return (
          <div key={key} title={`${Math.round(model.statXp[key])} xp`}>
            <div className="flex items-baseline justify-between">
              <dt className={`tracking-[0.18em] text-white/55 ${card ? "text-xs" : "text-[11px]"}`}>{key}</dt>
              <dd className={`text-white/90 ${card ? "text-base" : "text-sm"}`}>{level}</dd>
            </div>
            <div className={`mt-1 overflow-hidden rounded-full border border-white/8 bg-night/50 ${card ? "h-1.5" : "h-1"}`}>
              <div className={`h-full rounded-full ${palettes[statColors[key]].bar}`} style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </dl>
  );

  return card ? (
    <section className="flex w-full max-w-sm flex-col items-center gap-8 rounded-3xl border border-white/10 bg-night-panel px-6 py-8">
      {portrait}
      {stats}
    </section>
  ) : (
    <section className="shrink-0 rounded-3xl border border-white/10 bg-night-panel p-4">
      <div className="flex gap-8">
        {portrait}
        {stats}
      </div>
    </section>
  );
}
