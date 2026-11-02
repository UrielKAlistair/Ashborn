import type { ReactNode } from "react";

// The flat-topped hexagon in a 56 × 48 box
export const HEX_POINTS = "14,1.5 42,1.5 55,24 42,46.5 14,46.5 1,24";

// A flat-topped hexagon, the canvas's cell shape, behind a section's icon
export function HexTile({ active, className, children }: { active: boolean; className: string; children: ReactNode }) {
  return (
    <span className={`relative flex items-center justify-center ${className}`}>
      <svg viewBox="0 0 56 48" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <polygon
          points={HEX_POINTS}
          strokeLinejoin="round"
          strokeWidth="1.2"
          className={active ? "fill-ember/15 stroke-ember/60" : "fill-ink/[0.04] stroke-ink/12 transition-colors group-hover:fill-ink/[0.07] group-hover:stroke-ink/25"}
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  );
}

// The hexagon alone, faint, above an empty state or a sign-in
export function HexMark({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 56 48" aria-hidden="true" className={className}>
      <polygon points={HEX_POINTS} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
