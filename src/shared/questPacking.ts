import type { GraphEdge, Point } from "./types";

// Places the quests on the canvas: quests the user dragged stay where they are, and the rest fill
// the region that lets the whole layout fit the screen largest.

export type Size = { width: number; height: number };
export type PackedQuest = { id: string; size: Size };
export type PinnedQuest = { position: Point; size: Size };
export type Canvas = { width: number; height: number; maxZoom: number }; // the room a fit has

// Prerequisites before what they lead to, otherwise in the given order
export function prerequisitesFirst<T extends { id: string }>(quests: T[], edges: GraphEdge[]): T[] {
  const ordered: T[] = [];
  const seen = new Set<string>();
  const visit = (quest: T) => {
    if (seen.has(quest.id)) return;
    seen.add(quest.id);
    edges.filter((edge) => edge.to === quest.id).forEach((edge) => {
      const prerequisite = quests.find(({ id }) => id === edge.from);
      if (prerequisite) visit(prerequisite);
    });
    ordered.push(quest);
  };
  quests.forEach(visit);
  return ordered;
}

// The zoom a layout W wide and H tall is shown at is min(maxZoom, width / W, height / H). Of the
// region widths, the one kept shows the layout largest; among those tied (usually at maxZoom) it is
// the one with more than one column, then the closest to the canvas's shape. With no canvas, the
// region is the widest quest.
export function packQuests(pinned: PinnedQuest[], loose: PackedQuest[], canvas: Canvas | null, gap: number): Record<string, Point> {
  if (loose.length === 0) return {};
  const widest = Math.max(...loose.map(({ size }) => size.width));
  if (!canvas) return packWithin(widest, pinned, loose, gap);

  // Every width a row of the quests in order can need
  let row = -gap;
  const regionWidths = loose.map(({ size }) => Math.max(widest, (row += size.width + gap)));

  const scored = regionWidths.map((regionWidth) => {
    const positions = packWithin(regionWidth, pinned, loose, gap);
    const rects = [...pinned, ...loose.map(({ id, size }) => ({ position: positions[id], size }))];
    const width = Math.max(...rects.map((r) => r.position.x + r.size.width)) - Math.min(...rects.map((r) => r.position.x));
    const height = Math.max(...rects.map((r) => r.position.y + r.size.height)) - Math.min(...rects.map((r) => r.position.y));
    return {
      positions,
      zoom: Math.min(canvas.maxZoom, canvas.width / width, canvas.height / height),
      columns: new Set(loose.map(({ id }) => positions[id].x)).size > 1,
      shapeError: Math.abs(Math.log((width / height) / (canvas.width / canvas.height))),
    };
  });
  return scored.reduce((best, next) => {
    if (next.zoom !== best.zoom) return next.zoom > best.zoom ? next : best;
    if (next.columns !== best.columns) return next.columns ? next : best;
    return next.shapeError < best.shapeError ? next : best;
  }).positions;
}

// Each quest in turn takes the topmost, then leftmost, free spot in a region this wide
function packWithin(regionWidth: number, pinned: PinnedQuest[], loose: PackedQuest[], gap: number): Record<string, Point> {
  const taken = [...pinned];

  const free = (x: number, y: number, size: Size) =>
    taken.every(
      (other) =>
        x >= other.position.x + other.size.width + gap ||
        other.position.x >= x + size.width + gap ||
        y >= other.position.y + other.size.height + gap ||
        other.position.y >= y + size.height + gap,
    );

  const positions: Record<string, Point> = {};
  for (const { id, size } of loose) {
    // A topmost-leftmost free spot always touches the region's edge or another quest's far side
    const xs = [0, ...taken.map((other) => other.position.x + other.size.width + gap)].sort((a, b) => a - b);
    const ys = [0, ...taken.map((other) => other.position.y + other.size.height + gap)].sort((a, b) => a - b);
    const position = ys
      .flatMap((y) => xs.map((x) => ({ x, y })))
      .find(({ x, y }) => x >= 0 && y >= 0 && x + size.width <= regionWidth && free(x, y, size))!;
    positions[id] = position;
    taken.push({ position, size });
  }
  return positions;
}
