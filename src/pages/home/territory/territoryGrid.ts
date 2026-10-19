import { palettes, type Hue } from "../../../lib/theme";
import { hexCentre, hexColumnWidth, hexRowHeight } from "./hexgrid";

// Territories on the hex grid, as on the homepage's trail. Every cell asks one question: which
// thread am I closest to? The answer depends only on where the threads are right now, so any
// arrangement, overlaps included, always draws the same way and fully reverts when things move.
// A territory takes its thread's colour.

export const territoryCellRadius = 22; // circumradius of a flat-topped hex cell, in flow units
export const territoryReach = 52; // how far a territory extends beyond its thread's edge
const radius = territoryCellRadius;
const reach = territoryReach;

export type Rect = { x: number; y: number; width: number; height: number };
export type TerritoryThread = { id: string; rect: Rect; color: Hue; z: number };

const rowHeight = hexRowHeight(radius);
const columnWidth = hexColumnWidth(radius);
const gridBlock = 8; // the grid grows in blocks of cells, so dragging rarely rebuilds it

const cellCentre = (col: number, row: number) => hexCentre(col, row, radius);

// The six neighbours of a flat-topped cell in "odd columns shifted down" offset coordinates
const neighbours = (col: number, row: number): [number, number][] => {
  const shifted = Math.abs(col) % 2 === 1;
  return [
    [col, row - 1],
    [col, row + 1],
    [col - 1, shifted ? row : row - 1],
    [col - 1, shifted ? row + 1 : row],
    [col + 1, shifted ? row : row - 1],
    [col + 1, shifted ? row + 1 : row],
  ];
};

const distanceToRect = (x: number, y: number, r: Rect) => {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.width));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.height));
  return Math.hypot(dx, dy);
};

// `neighbours` holds the indices, in `cells`, of the neighbouring cells that are in the grid
export type GridCell = { key: string; col: number; row: number; x: number; y: number; neighbours: number[] };
export type Grid = { cols: [number, number]; rows: [number, number]; cells: GridCell[] };

// Covers the threads plus reach, rounded out to whole blocks
export function gridExtent(threads: TerritoryThread[]) {
  const block = (value: number, size: number, round: (n: number) => number) => round(value / size / gridBlock) * gridBlock;
  const cols: [number, number] = [
    block(Math.min(...threads.map((c) => c.rect.x)) - reach - radius, columnWidth, Math.floor),
    block(Math.max(...threads.map((c) => c.rect.x + c.rect.width)) + reach + radius, columnWidth, Math.ceil),
  ];
  const rows: [number, number] = [
    block(Math.min(...threads.map((c) => c.rect.y)) - reach - radius, rowHeight, Math.floor),
    block(Math.max(...threads.map((c) => c.rect.y + c.rect.height)) + reach + radius, rowHeight, Math.ceil),
  ];
  return { cols, rows };
}

export function buildGrid({ cols, rows }: { cols: [number, number]; rows: [number, number] }): Grid {
  const height = rows[1] - rows[0] + 1;
  const indexOf = (col: number, row: number) =>
    col < cols[0] || col > cols[1] || row < rows[0] || row > rows[1] ? -1 : (col - cols[0]) * height + (row - rows[0]);
  const cells: GridCell[] = [];
  for (let col = cols[0]; col <= cols[1]; col++) {
    for (let row = rows[0]; row <= rows[1]; row++) {
      const around = neighbours(col, row).map(([c, r]) => indexOf(c, r)).filter((index) => index >= 0);
      cells.push({ key: `${col},${row}`, col, row, ...cellCentre(col, row), neighbours: around });
    }
  }
  return { cols, rows, cells };
}

export type CellLook = { color?: Hue; owner?: string; distance: number; level: number; frontier: boolean };

// One look per cell, in the order of grid.cells
export function computeOwners(grid: Grid, threads: TerritoryThread[]): CellLook[] {
  const looks = grid.cells.map((cell): CellLook => {
    let best: TerritoryThread | undefined;
    let bestDistance = Infinity;
    for (const thread of threads) {
      const d = distanceToRect(cell.x, cell.y, thread.rect);
      // Ties (e.g. a cell under two overlapping threads) go to the one on top
      if (d < bestDistance - 0.5 || (Math.abs(d - bestDistance) <= 0.5 && best && thread.z > best.z)) {
        best = thread;
        bestDistance = d;
      }
    }
    const owned = best && bestDistance <= reach;
    // Three strength levels: under or beside a thread, nearby, at the edge of reach
    const level = !owned ? 0 : bestDistance < reach / 3 ? 3 : bestDistance < (reach * 2) / 3 ? 2 : 1;
    return { color: owned ? best!.color : undefined, owner: owned ? best!.id : undefined, distance: bestDistance, level, frontier: false };
  });
  // Cells beyond the grid's edge count as unowned
  grid.cells.forEach((cell, i) => {
    const look = looks[i];
    if (look.color) look.frontier = cell.neighbours.length < 6 || cell.neighbours.some((n) => looks[n].color !== look.color);
  });
  return looks;
}

// An owned cell's colour, with the opacities of its fill and outline: stronger near a thread
// and along a territory's border
export function cellPaint(color: Hue, look: CellLook) {
  return {
    rgb: palettes[color].rgb,
    fill: 0.012 + look.level * 0.012 + (look.frontier ? 0.012 : 0),
    stroke: 0.05 + look.level * 0.03 + (look.frontier ? 0.06 : 0),
  };
}

// The bare fabric: every cell's outline, faintly, everywhere. It fades out when zoomed far out,
// where the cells would shrink to a few pixels and shimmer.
export const fabric = { rgb: [255, 255, 255], alpha: 0.055 } as const;
export const fabricOpacity = (zoom: number) => Math.min(1, Math.max(0, (zoom - 0.2) / 0.25));
