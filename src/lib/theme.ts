// Priority colours as style classes, for the quest dots, bars and hexes.
import type { Priority } from "../shared/types";

// A quest's colour is its priority's: the most urgent in it, as on the graph's rail. It colours the
// quest's dot, its bar and its hex territory (which reads the same --priority-N from the theme). A
// quest with none is drawn in the theme's ink.
export type Hue = Priority | "none";
export type Palette = { dot: string; hexFill: string; bar: string };

export const palettes: Record<Hue, Palette> = {
  1: { dot: "bg-(--priority-1)", hexFill: "fill-(--priority-1)", bar: "bg-(--priority-1)" },
  2: { dot: "bg-(--priority-2)", hexFill: "fill-(--priority-2)", bar: "bg-(--priority-2)" },
  3: { dot: "bg-(--priority-3)", hexFill: "fill-(--priority-3)", bar: "bg-(--priority-3)" },
  4: { dot: "bg-(--priority-4)", hexFill: "fill-(--priority-4)", bar: "bg-(--priority-4)" },
  none: { dot: "bg-ink/70", hexFill: "fill-ink/70", bar: "bg-ink/50" },
};

export const paletteOf = (priority: Priority | undefined) => palettes[priority ?? "none"];
