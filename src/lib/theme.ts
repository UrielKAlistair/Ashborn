import type { QuestColor } from "../shared/types";

// A quest's colour, chosen in its ⋯ menu, in the style of the trail's chapters: a dot, a border,
// a tint fading down the panel, and the bar. `rgb` colours its hex territory. Uncoloured quests
// are white.
export type Hue = QuestColor | "none";
export type Palette = { dot: string; hexFill: string; border: string; tint: string; bar: string; rgb: [number, number, number] };

export const palettes: Record<Hue, Palette> = {
  red: { dot: "bg-red-400", hexFill: "fill-red-400", border: "border-red-300/25", tint: "from-red-400/[0.09]", bar: "bg-red-300/80", rgb: [248, 113, 113] },
  orange: { dot: "bg-orange-400", hexFill: "fill-orange-400", border: "border-orange-300/25", tint: "from-orange-400/[0.09]", bar: "bg-orange-300/80", rgb: [251, 146, 60] },
  amber: { dot: "bg-amber-400", hexFill: "fill-amber-400", border: "border-amber-300/25", tint: "from-amber-400/[0.09]", bar: "bg-amber-300/80", rgb: [251, 191, 36] },
  green: { dot: "bg-emerald-400", hexFill: "fill-emerald-400", border: "border-emerald-300/25", tint: "from-emerald-400/[0.09]", bar: "bg-emerald-300/80", rgb: [52, 211, 153] },
  teal: { dot: "bg-teal-400", hexFill: "fill-teal-400", border: "border-teal-300/25", tint: "from-teal-400/[0.09]", bar: "bg-teal-300/80", rgb: [45, 212, 191] },
  blue: { dot: "bg-blue-500", hexFill: "fill-blue-500", border: "border-blue-400/30", tint: "from-blue-600/[0.12]", bar: "bg-blue-500/85", rgb: [59, 110, 240] },
  violet: { dot: "bg-violet-400", hexFill: "fill-violet-400", border: "border-violet-300/25", tint: "from-violet-400/[0.09]", bar: "bg-violet-300/80", rgb: [167, 139, 250] },
  pink: { dot: "bg-pink-400", hexFill: "fill-pink-400", border: "border-pink-300/25", tint: "from-pink-400/[0.09]", bar: "bg-pink-300/80", rgb: [244, 114, 182] },
  none: { dot: "bg-slate-200", hexFill: "fill-slate-200", border: "border-ink/20", tint: "from-ink/[0.05]", bar: "bg-slate-200/70", rgb: [226, 232, 240] },
};

export const paletteOf = (color: QuestColor | null) => palettes[color ?? "none"];
