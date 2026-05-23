import type { ReactNode } from "react";

type AtlasEntryLayoutProps = {
  children?: ReactNode;
  eyebrow: string;
  title: string;
};

export function AtlasEntryLayout({
  children,
  eyebrow,
  title,
}: AtlasEntryLayoutProps) {
  return (
    <section className="min-h-full w-full">
      <p className="text-xs uppercase tracking-[0.32em] text-white/40">
        {eyebrow}
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
        {title}
      </h1>
      <div className="mt-6 rounded-2xl border border-white/10 bg-black/15 p-5">
        {children}
      </div>
    </section>
  );
}
