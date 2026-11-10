import type { Hue } from "../../../lib/theme";
import { hexCentre, hexColumnWidth, hexRowHeight } from "./hexgrid";

// Territories on the hex grid, as on the trail of the user's own homepage, where the look came from
// (design 38). Every cell asks one question: which quest's box is its centre closest to, within reach?
// The answer depends only on where the quests are right now, so any arrangement, overlaps included,
// always draws the same way and fully reverts when things move. A territory takes its quest's colour;
// how bright each pixel of it is, the renderer works out from the owner's box.

export const territoryCellRadius = 22; // circumradius of a flat-topped hex cell, in flow units
export const territoryReach = 52; // how far a territory extends beyond its quest's edge
const radius = territoryCellRadius;
const reach = territoryReach;

export type Rect = { x: number; y: number; width: number; height: number };
export type TerritoryQuest = { id: string; rect: Rect; color: Hue; z: number };

const rowHeight = hexRowHeight(radius);
const columnWidth = hexColumnWidth(radius);
const gridBlock = 8; // the grid grows in blocks of cells, so dragging rarely rebuilds it

const cellCentre = (col: number, row: number) => hexCentre(col, row, radius);

const distanceToRect = (x: number, y: number, r: Rect) => {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.width));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.height));
  return Math.hypot(dx, dy);
};

export type GridCell = { key: string; col: number; row: number; x: number; y: number };
export type Grid = { cols: [number, number]; rows: [number, number]; cells: GridCell[] };

// Covers the quests plus reach, rounded out to whole blocks
export function gridExtent(quests: TerritoryQuest[]) {
  const block = (value: number, size: number, round: (n: number) => number) => round(value / size / gridBlock) * gridBlock;
  const cols: [number, number] = [
    block(Math.min(...quests.map((c) => c.rect.x)) - reach - radius, columnWidth, Math.floor),
    block(Math.max(...quests.map((c) => c.rect.x + c.rect.width)) + reach + radius, columnWidth, Math.ceil),
  ];
  const rows: [number, number] = [
    block(Math.min(...quests.map((c) => c.rect.y)) - reach - radius, rowHeight, Math.floor),
    block(Math.max(...quests.map((c) => c.rect.y + c.rect.height)) + reach + radius, rowHeight, Math.ceil),
  ];
  return { cols, rows };
}

export function buildGrid({ cols, rows }: { cols: [number, number]; rows: [number, number] }): Grid {
  const cells: GridCell[] = [];
  for (let col = cols[0]; col <= cols[1]; col++) {
    for (let row = rows[0]; row <= rows[1]; row++) cells.push({ key: `${col},${row}`, col, row, ...cellCentre(col, row) });
  }
  return { cols, rows, cells };
}

export type CellLook = { color?: Hue; owner?: string };

// One look per cell, in the order of grid.cells
export function computeOwners(grid: Grid, quests: TerritoryQuest[]): CellLook[] {
  return grid.cells.map((cell): CellLook => {
    let best: TerritoryQuest | undefined;
    let bestDistance = Infinity;
    for (const quest of quests) {
      const d = distanceToRect(cell.x, cell.y, quest.rect);
      // Ties (e.g. a cell under two overlapping quests) go to the one on top
      if (d < bestDistance - 0.5 || (Math.abs(d - bestDistance) <= 0.5 && best && quest.z > best.z)) {
        best = quest;
        bestDistance = d;
      }
    }
    const owned = best && bestDistance <= reach;
    return { color: owned ? best!.color : undefined, owner: owned ? best!.id : undefined };
  });
}

// The bare fabric fades out when zoomed far out, where the cells would shrink to a few pixels and
// shimmer
export const fabricOpacity = (zoom: number) => Math.min(1, Math.max(0, (zoom - 0.2) / 0.25));
