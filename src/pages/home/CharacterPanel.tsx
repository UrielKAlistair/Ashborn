import { HEX_POINTS } from "../../components/HexTile";
import { statKeys, type GraphModel } from "../../shared/graphModel";
import { statLevel } from "../../shared/progression";
import type { StatKey } from "../../shared/types";
import { Portrait, portraitTiers } from "./Portrait";

// The portrait advances one sprite tier every PORTRAIT_TIER_LEVELS overall levels
const PORTRAIT_TIER_LEVELS = 5;
// How much larger the portrait is drawn on the phone's character card
const CARD_PORTRAIT_ZOOM = 2;
// Each stat's bar has a colour of its own, unrelated to the colours of quests
const statBars: Record<StatKey, string> = { STR: "bg-red-300/80", DEX: "bg-orange-300/80", INT: "bg-blue-500/85", WIS: "bg-emerald-300/80", CHR: "bg-violet-300/80", MND: "bg-teal-300/80" };

// The character: portrait, overall level and the six stats. On the desktop a row beside the
// to-do list; on the phone (`card`) a tall card with a larger portrait and the stats beneath it.
export function CharacterPanel({ model, card = false }: { model: GraphModel; card?: boolean }) {
  const overall = statLevel(model.totalStatXp);
  const tier = Math.min(portraitTiers, Math.floor((overall.level - 1) / PORTRAIT_TIER_LEVELS) + 1);

  // The portrait stands on a hex cell of the canvas's fabric, the overall level beneath it
  const portrait = (
    <div className={`flex shrink-0 flex-col items-center ${card ? "w-48" : "w-28"}`}>
      <div className={`relative flex items-end justify-center ${card ? "w-48" : "w-28"}`}>
        <svg viewBox="0 0 56 48" className="absolute inset-x-0 bottom-0 mx-auto w-full" aria-hidden="true">
          <polygon points={HEX_POINTS} strokeLinejoin="round" strokeWidth="0.6" className="fill-ink/[0.03] stroke-ink/35" />
        </svg>
        <div className="relative">
          <Portrait tier={tier} zoom={card ? CARD_PORTRAIT_ZOOM : 1} />
        </div>
      </div>
      <p className={`caps mt-3 font-display font-bold text-ink/80 ${card ? "text-base" : "text-[12px]"}`}>
        Lvl <span className="text-ember">{overall.level}</span>
      </p>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink/8">
        <div className="progress-fill h-full rounded-full bg-ember" style={{ width: `${overall.percent}%` }} />
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
              <dt className={`font-display font-medium tracking-[0.08em] text-muted ${card ? "text-xs" : "text-[11px]"}`}>{key}</dt>
              <dd className={`font-mono text-ink/90 ${card ? "text-base" : "text-[13px]"}`}>{level}</dd>
            </div>
            <div className={`mt-1 overflow-hidden rounded-full bg-ink/8 ${card ? "h-1.5" : "h-1"}`}>
              <div className={`progress-fill h-full rounded-full ${statBars[key]}`} style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </dl>
  );

  return card ? (
    <section className="panel-lift flex w-full max-w-sm flex-col items-center gap-8 rounded-2xl border border-ink/8 bg-panel px-6 py-8">
      {portrait}
      {stats}
    </section>
  ) : (
    <section className="panel-lift shrink-0 rounded-2xl border border-ink/8 bg-panel px-5 py-4">
      <div className="flex items-center gap-7">
        {portrait}
        {stats}
      </div>
    </section>
  );
}
