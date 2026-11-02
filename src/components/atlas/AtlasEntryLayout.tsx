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
    <section className="mx-auto min-h-full w-full max-w-3xl">
      <p className="text-[11.5px] text-white/45">
        {eyebrow}
      </p>
      <h1 className="mt-1 font-display text-3xl font-semibold text-white/90">
        {title}
      </h1>
      <div className="mt-6">
        {children}
      </div>
    </section>
  );
}
