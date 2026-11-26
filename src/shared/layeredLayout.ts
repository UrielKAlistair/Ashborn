/**
 * Lays out the steps of one box: a DAG whose links run from a prerequisite to what it leads to.
 *
 * Input: the steps in priority order with their sizes, the links between them, the direction the
 * links run (RIGHT on the desktop, DOWN on the phone) and the gaps. Output: each step's top-left
 * corner, relative to the box's content corner.
 *
 * Steps, per group of linked steps (a component; components stack top to bottom in the order of
 * their first step):
 * 1. Layers: a step sits one layer past its latest prerequisite; a step with no prerequisites sits
 *    just before the earliest step it leads to, so its link stays short.
 * 2. Order within a layer: priority order, then sweeps that move each step towards the mean place
 *    of its neighbours in the layer before (then after), keeping the order with the fewest
 *    crossings. A link spanning several layers passes through a placeholder in each, so it counts.
 * 3. Coordinates: layers stack along the direction; within a layer, each step sits level with the
 *    median of its prerequisites where the order and the gap allow.
 */
import type { GraphEdge, Point } from "./types";
import type { Size } from "./questPacking";

export type Direction = "RIGHT" | "DOWN";
export type Spacing = { step: number; layer: number; component: number };
export type LaidOutStep = { id: string; size: Size };

const sweeps = 8;

export function layeredLayout(steps: LaidOutStep[], links: GraphEdge[], direction: Direction, spacing: Spacing): Record<string, Point> {
  const positions: Record<string, Point> = {};
  let top = 0;
  for (const component of components(steps, links)) {
    const placed = layOutComponent(component, links, direction, spacing);
    const height = Math.max(...component.map(({ id, size }) => placed[id].y + size.height));
    component.forEach(({ id }) => (positions[id] = { x: placed[id].x, y: placed[id].y + top }));
    top += height + spacing.component;
  }
  return positions;
}

// Groups of steps joined by links, each in priority order, ordered by their first step
function components(steps: LaidOutStep[], links: GraphEdge[]): LaidOutStep[][] {
  const group = new Map(steps.map(({ id }) => [id, id]));
  const root = (id: string): string => (group.get(id) === id ? id : root(group.get(id)!));
  links.forEach(({ from, to }) => {
    const [a, b] = [root(from), root(to)];
    if (a !== b) group.set(b, a);
  });
  const byRoot = new Map<string, LaidOutStep[]>();
  steps.forEach((step) => {
    const key = root(step.id);
    byRoot.set(key, [...(byRoot.get(key) ?? []), step]);
  });
  return [...byRoot.values()];
}

// A layer entry: a step, or a placeholder where a long link crosses the layer
type Slot = { id: string; real: boolean };

function layOutComponent(steps: LaidOutStep[], allLinks: GraphEdge[], direction: Direction, spacing: Spacing): Record<string, Point> {
  const ids = new Set(steps.map(({ id }) => id));
  const links = allLinks.filter(({ from, to }) => ids.has(from) && ids.has(to));
  const rank = new Map(steps.map(({ id }, i) => [id, i]));
  const layerOf = assignLayers(steps, links);

  // Each link becomes a chain of unit links through a placeholder per layer it crosses
  const count = Math.max(...layerOf.values()) + 1;
  const layers: Slot[][] = Array.from({ length: count }, () => []);
  steps.forEach(({ id }) => layers[layerOf.get(id)!].push({ id, real: true }));
  const unitLinks: Array<[string, string]> = [];
  links.forEach(({ from, to }, n) => {
    let previous = from;
    for (let layer = layerOf.get(from)! + 1; layer < layerOf.get(to)!; layer++) {
      const placeholder = `\u0000${n}:${layer}`;
      layers[layer].push({ id: placeholder, real: false });
      // A placeholder ranks with the step its link leaves, so it starts beside it
      rank.set(placeholder, rank.get(from)!);
      unitLinks.push([previous, placeholder]);
      previous = placeholder;
    }
    unitLinks.push([previous, to]);
  });
  layers.forEach((layer) => layer.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!));

  const ordered = orderLayers(layers, unitLinks, rank);
  return assignCoordinates(ordered, unitLinks, steps, direction, spacing);
}

// Longest path from the sources, then each source moved up to just before its earliest successor
function assignLayers(steps: LaidOutStep[], links: GraphEdge[]): Map<string, number> {
  const layerOf = new Map<string, number>();
  const prerequisites = (id: string) => links.filter(({ to }) => to === id).map(({ from }) => from);
  const successors = (id: string) => links.filter(({ from }) => from === id).map(({ to }) => to);
  const visit = (id: string): number => {
    if (!layerOf.has(id)) layerOf.set(id, Math.max(-1, ...prerequisites(id).map(visit)) + 1);
    return layerOf.get(id)!;
  };
  steps.forEach(({ id }) => visit(id));
  steps.forEach(({ id }) => {
    const after = successors(id);
    if (prerequisites(id).length === 0 && after.length > 0) layerOf.set(id, Math.min(...after.map((next) => layerOf.get(next)!)) - 1);
  });
  return layerOf;
}

// Barycentre sweeps, down then up, keeping the order with the fewest crossings (the earliest on a tie)
function orderLayers(layers: Slot[][], links: Array<[string, string]>, rank: Map<string, number>): Slot[][] {
  const before = new Map<string, string[]>();
  const after = new Map<string, string[]>();
  links.forEach(([from, to]) => {
    after.set(from, [...(after.get(from) ?? []), to]);
    before.set(to, [...(before.get(to) ?? []), from]);
  });

  let current = layers.map((layer) => [...layer]);
  let best = current;
  let fewest = crossings(current, after);
  for (let sweep = 0; sweep < sweeps && fewest > 0; sweep++) {
    const down = sweep % 2 === 0;
    const next = current.map((layer) => [...layer]);
    const order = down ? next.map((_, i) => i).slice(1) : next.map((_, i) => i).slice(0, -1).reverse();
    for (const i of order) {
      const fixed = new Map(next[down ? i - 1 : i + 1].map(({ id }, at) => [id, at]));
      const neighbours = down ? before : after;
      const keyOf = new Map(
        next[i].map(({ id }, at) => {
          const places = (neighbours.get(id) ?? []).map((other) => fixed.get(other)!);
          // A step with no neighbours that side keeps its place
          return [id, places.length > 0 ? places.reduce((a, b) => a + b, 0) / places.length : at];
        }),
      );
      next[i].sort((a, b) => keyOf.get(a.id)! - keyOf.get(b.id)! || rank.get(a.id)! - rank.get(b.id)!);
    }
    current = next;
    const crossed = crossings(current, after);
    if (crossed < fewest) [best, fewest] = [current, crossed];
  }
  return best;
}

// Pairs of unit links between adjacent layers whose ends are in opposite orders
export function crossings(layers: Slot[][], after: Map<string, string[]>): number {
  let total = 0;
  for (let i = 0; i + 1 < layers.length; i++) {
    const at = new Map(layers[i + 1].map(({ id }, place) => [id, place]));
    const pairs = layers[i].flatMap(({ id }, place) => (after.get(id) ?? []).map((to) => [place, at.get(to)!]));
    for (let a = 0; a < pairs.length; a++)
      for (let b = a + 1; b < pairs.length; b++) if ((pairs[a][0] - pairs[b][0]) * (pairs[a][1] - pairs[b][1]) < 0) total++;
  }
  return total;
}

// Layers stack along the direction, each as deep as its deepest step. Across, each layer's slots keep
// their order with the gap between them, each step as near the median centre of its prerequisites as
// that allows (placeholders take no room and are skipped).
function assignCoordinates(layers: Slot[][], links: Array<[string, string]>, steps: LaidOutStep[], direction: Direction, spacing: Spacing): Record<string, Point> {
  const sizeOf = new Map(steps.map(({ id, size }) => [id, size]));
  const along = (size: Size) => (direction === "RIGHT" ? size.width : size.height);
  const across = (size: Size) => (direction === "RIGHT" ? size.height : size.width);
  // Real prerequisites through any placeholders, for alignment
  const before = new Map<string, string[]>();
  links.forEach(([from, to]) => before.set(to, [...(before.get(to) ?? []), from]));
  const realBefore = (id: string): string[] =>
    (before.get(id) ?? []).flatMap((from) => (sizeOf.has(from) ? [from] : realBefore(from)));

  const centre = new Map<string, number>();
  const start = new Map<string, number>();
  let depth = 0;
  layers.forEach((layer) => {
    const real = layer.filter(({ real }) => real).map(({ id }) => id);
    let reach: number | null = null; // the far edge of the last step placed, plus the gap
    real.forEach((id) => {
      const size = across(sizeOf.get(id)!);
      const wanted = median(realBefore(id).map((from) => centre.get(from)!));
      const from = wanted === null ? (reach ?? 0) : Math.max(reach ?? -Infinity, wanted - size / 2);
      centre.set(id, from + size / 2);
      start.set(id, depth);
      reach = from + size + spacing.step;
    });
    depth += Math.max(0, ...real.map((id) => along(sizeOf.get(id)!))) + spacing.layer;
  });

  // Shift so the component starts at 0 across
  const least = Math.min(...steps.map(({ id, size }) => centre.get(id)! - across(size) / 2));
  const positions: Record<string, Point> = {};
  steps.forEach(({ id, size }) => {
    const a = start.get(id)!;
    const c = centre.get(id)! - across(size) / 2 - least;
    positions[id] = direction === "RIGHT" ? { x: a, y: c } : { x: c, y: a };
  });
  return positions;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
