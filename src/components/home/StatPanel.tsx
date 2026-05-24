import type { StatPanelProps } from "./types";

export function StatPanel({ fp, hp, stats }: StatPanelProps) {
  const hpPercent = Math.max(0, Math.min(100, (hp.current / hp.max) * 100));
  const fpPercent = Math.max(0, Math.min(100, (fp.current / fp.max) * 100));

  return (
    <aside className="flex h-full w-full flex-col rounded-[28px] border border-white/12 bg-white/6 p-4 backdrop-blur-xl">
      <div className="grid min-h-0 flex-1 grid-cols-[1.35fr_0.9fr] gap-3">
        <div className="flex min-h-0 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-center text-[10px] uppercase tracking-[0.22em] text-white/45">
          Character
          <br />
          Pixel Art
        </div>

        <div className="min-h-0">
          <dl className="grid h-full grid-rows-6 gap-1">
            {stats.map((stat) => (
              <div
                key={stat.key}
                className="flex min-h-0 flex-col justify-center rounded-xl border border-white/8 bg-black/15 px-3 py-1.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[13px] tracking-[0.18em] text-white/60">{stat.key}</dt>
                  <dd className="text-sm font-medium text-white">{stat.value}</dd>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full border border-white/8 bg-black/25">
                  <div
                    className="h-full rounded-full bg-[#d7c17d]"
                    style={{ width: `${stat.xpProgressPercent}%` }}
                  />
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <section className="mt-3 shrink-0 rounded-2xl border border-white/10 bg-black/15 p-3">
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.24em] text-white/55">HP</p>
            <p className="text-[11px] tracking-[0.16em] text-white/45">
              {hp.current}/{hp.max}
            </p>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full border border-white/8 bg-black/25">
            <div className="h-full rounded-full bg-[#c43a4f]" style={{ width: `${hpPercent}%` }} />
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.24em] text-white/55">FP</p>
            <p className="text-[11px] tracking-[0.16em] text-white/45">
              {fp.current}/{fp.max}
            </p>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full border border-white/8 bg-black/25">
            <div className="h-full rounded-full bg-[#8cecff]" style={{ width: `${fpPercent}%` }} />
          </div>
        </div>

        <p className="mt-3 text-[11px] tracking-[0.14em] text-white/45">EXP multiplier: 1.2x</p>
      </section>
    </aside>
  );
}
