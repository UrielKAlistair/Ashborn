import type { StatPanelProps } from "./types";

export function StatPanel({ fp, hp, stats }: StatPanelProps) {
  const hpPercent = Math.max(0, Math.min(100, (hp.current / hp.max) * 100));
  const fpPercent = Math.max(0, Math.min(100, (fp.current / fp.max) * 100));

  return (
    <aside className="w-full rounded-[28px] border border-white/12 bg-white/6 p-5 backdrop-blur-xl">
      <div className="flex gap-4">
        <div className="flex h-[17.5rem] w-[13rem] shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-center text-xs uppercase tracking-[0.24em] text-white/45">
          Character
          <br />
          Pixel Art
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between">
          <dl className="mt-1 space-y-1">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="flex items-center justify-between rounded-xl border border-white/8 bg-black/15 px-3 py-2"
              >
                <dt className="text-sm tracking-[0.2em] text-white/60">{stat.label}</dt>
                <dd className="text-base font-medium text-white">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <section className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
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

        <div className="mt-4">
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

        <p className="mt-4 text-xs tracking-[0.16em] text-white/45">EXP multiplier: 1.2x</p>
      </section>
    </aside>
  );
}
