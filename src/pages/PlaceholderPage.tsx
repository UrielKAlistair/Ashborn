// A page that is planned but not built yet
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-3xl border border-white/10 bg-night-panel text-center">
      <h1 className="text-sm uppercase tracking-[0.3em] text-white/75">{title}</h1>
      <p className="text-xs tracking-[0.14em] text-white/40">Coming soon.</p>
    </section>
  );
}
