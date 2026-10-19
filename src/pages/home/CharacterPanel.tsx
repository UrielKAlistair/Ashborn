import mage1 from "../../assets/mage_1.png";
import mage2 from "../../assets/mage_2.png";
import mage3 from "../../assets/mage_3.png";
import mage4 from "../../assets/mage_4.png";
import { statLevel } from "../../shared/progression";
import { statKeys, type GraphModel } from "./graphModel";

// The portrait advances one sprite every PORTRAIT_TIER_LEVELS overall levels
const portraits = [mage1, mage2, mage3, mage4];
const PORTRAIT_TIER_LEVELS = 5;

export function CharacterPanel({ model }: { model: GraphModel }) {
  const overall = statLevel(model.totalStatXp);
  const portrait = portraits[Math.min(portraits.length - 1, Math.floor((overall.level - 1) / PORTRAIT_TIER_LEVELS))];

  return (
    <section className="shrink-0 rounded-[24px] border border-white/12 bg-white/6 p-4 backdrop-blur-xl">
      <div className="flex gap-4">
        <div className="flex w-24 shrink-0 flex-col items-center">
          <img src={portrait} alt="" className="h-24 w-24 object-contain [image-rendering:pixelated]" />
          <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-white/55">Lv {overall.level}</p>
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-black/30">
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
                <div className="mt-1 h-1 overflow-hidden rounded-full border border-white/8 bg-black/25">
                  <div className="h-full rounded-full bg-[#d7c17d]" style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}
