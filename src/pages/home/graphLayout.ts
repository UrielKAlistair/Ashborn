/**
 * Where the graph's cards go and how big they are.
 *
 * Input: the quests shown, the steps each box shows, and their links. Output: a Box per card (its
 * position relative to its parent box, its size and its title row's height), from layoutTree.
 * Inside a box, the steps are laid out in layers, prerequisites first (shared/layeredLayout); a box
 * is as big as its contents. Quests are then packed on the canvas
 * (shared/questPacking).
 * Sizes come from the titles as the browser wraps them (titleLines.ts), so the constants here and the
 * cards' classes (graphCards.tsx) must agree. The phone's camera, at the end, frames this layout.
 */
import { type XYPosition } from "@xyflow/react";
import { type GraphModel } from "../../shared/graphModel";
import { layeredLayout } from "../../shared/layeredLayout";
import { packQuests, prerequisitesFirst, type Canvas, type Size } from "../../shared/questPacking";
import { type GraphEdge, type GraphNode } from "../../shared/types";
import { labelWidth, lineHeight, measureTitles, titleLines, type TitleText } from "./titleLines";

// Box sizes. A quest is a header above its steps; a step is a row that grows into a box when
// it holds steps of its own. A box being added to gets an input row at the bottom.
export const questHeader = { width: 264, height: 76 };
export const stepRow = { width: 248, height: 40 };
export const addRowHeight = 40;
const padding = 16;

// Titles wrap to three lines (titleMaxLines, line-clamp-3 on the cards), and a card grows by a
// line's height for each line past the first. Below, the classes and fixed parts that set the
// room a title has.
export const questTitleType = "font-display text-[14px] leading-snug font-semibold break-words";
export const stepTitleType = (holdsSteps: boolean) => `text-[12.5px] break-words ${holdsSteps ? "font-medium" : ""}`;
export const plusOneButton = "rounded-md bg-ember/15 px-1.5 py-[3px] font-mono text-[10px] leading-none font-semibold text-ember hover:bg-ember/25";

// Every step row keeps room for the Now pill or its P label, so Now moving never changes a height
export const labelSlot = 32;
const iconSize = 24; // iconButton
const phoneMenuWidth = 32;

// Where nothing can hover (a touch screen in the desktop layout), a quest's buttons stay in its
// header: group-hover never applies there
export const canHover = window.matchMedia("(hover: hover)").matches;
const questGap = 40;
export const zoomRange = { min: 0.15, max: 2 };

// position is relative to the parent box; header is the height of its title row
export type Box = { position: XYPosition; size: Size; header: number };

type Measured = Size & { header: number };

// What sits beside a card's title, which sets the room the title has
export type CardShape = { phone: boolean; hasSteps: (id: string) => boolean; collapsed: (id: string) => boolean; folded: (id: string) => boolean };

// Lays out every rendered level. Inside a box, the steps are laid out with prerequisites to the left;
// a box is as big as its content needs. Quests are packed to the canvas's shape.
// On the phone prerequisites run top to bottom, and the quests fill rows as wide as the screen at
// the phone's zoom, in the order given (one column upright, more on its side).
export function layoutTree(
  quests: GraphNode[],
  edges: GraphEdge[],
  stepsOf: (id: string) => GraphNode[],
  addingTo: string | null,
  canvas: Canvas | number,
  shape: CardShape,
) {
  const placements: Record<string, Box> = {};
  const direction = shape.phone ? "DOWN" : "RIGHT";
  const headerOf = (node: GraphNode, depth: number, width: number) => headerHeight(node, depth, width, shape);
  // Every title at its card's narrowest, in one pass; only a box wider than that is measured again
  const titles: TitleText[] = [];
  const collect = (node: GraphNode, depth: number) => {
    const title = titleText(node, depth, depth === 0 ? questHeader.width : stepRow.width, shape);
    if (title) titles.push(title);
    stepsOf(node.id).forEach((step) => collect(step, depth + 1));
  };
  quests.forEach((quest) => collect(quest, 0));
  measureTitles(titles);

  const layoutSteps = (nodes: GraphNode[], sizes: Size[]): Record<string, XYPosition> => {
    const ids = new Set(nodes.map((node) => node.id));
    const links = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    // Room for a link's arrow between layers: across on the desktop, down on the phone
    return layeredLayout(nodes.map((node, i) => ({ id: node.id, size: sizes[i] })), links, direction, { step: 12, layer: shape.phone ? 28 : 48, component: 12 });
  };

  // Places `nodes` in a box whose content starts at `origin`; returns the content's far corner
  const arrange = (nodes: GraphNode[], sizes: Measured[], origin: XYPosition) => {
    const positions = layoutSteps(nodes, sizes);
    let right = origin.x;
    let bottom = origin.y;
    nodes.forEach((node, i) => {
      const position = { x: origin.x + positions[node.id].x, y: origin.y + positions[node.id].y };
      placements[node.id] = placed(position, sizes[i]);
      right = Math.max(right, position.x + sizes[i].width);
      bottom = Math.max(bottom, position.y + sizes[i].height);
    });
    return { right, bottom };
  };

  const measure = (node: GraphNode, depth: number): Measured => {
    const base = depth === 0 ? questHeader : stepRow;
    const addRow = node.id === addingTo ? addRowHeight : 0;
    const steps = stepsOf(node.id);
    if (steps.length === 0) {
      const header = headerOf(node, depth, base.width);
      return { width: base.width, height: header + addRow, header };
    }

    // A box is as wide as its steps need, and its title wraps to that width; the steps are placed
    // again if the header then takes a different number of lines
    const sizes = steps.map((step) => measure(step, depth + 1));
    const first = headerOf(node, depth, base.width);
    const arranged = arrange(steps, sizes, { x: padding, y: first });
    const width = Math.max(base.width, arranged.right + padding);
    const header = headerOf(node, depth, width);
    const { bottom } = header === first ? arranged : arrange(steps, sizes, { x: padding, y: header });
    return { width, height: bottom + (addRow || padding / 2), header };
  };

  const sizes = quests.map((quest) => measure(quest, 0));
  const sized = quests.map((quest, i) => ({ id: quest.id, size: sizes[i] }));
  if (typeof canvas === "number") {
    const row = canvas / phoneZoom(Math.max(...sizes.map((size) => size.width)), canvas);
    const packed = packQuests(sized, row, questGap);
    quests.forEach((quest, i) => (placements[quest.id] = placed(packed[quest.id], sizes[i])));
    return placements;
  }
  const packed = packQuests(prerequisitesFirst(sized, edges), canvas, questGap);
  quests.forEach((quest, i) => (placements[quest.id] = placed(packed[quest.id], sizes[i])));

  return placements;
}

const placed = (position: XYPosition, { width, height, header }: Measured): Box => ({ position, size: { width, height }, header });

// A card's title row: its height, grown by a line for each line its title wraps to past the first
function headerHeight(node: GraphNode, depth: number, width: number, shape: CardShape) {
  const base = depth === 0 ? questHeader.height : stepRow.height;
  const title = titleText(node, depth, width, shape);
  return title ? base + (titleLines(title) - 1) * lineHeight(title.className) : base;
}

// A card's title as the card sets it, at the width it gets: the card's less the fixed parts beside
// it. A folded box's one line is cut, not wrapped.
function titleText(node: GraphNode, depth: number, width: number, shape: CardShape): TitleText | null {
  if (depth === 0) {
    // px-4, the hex dot (w-3.5) and its gap-2
    const fixed = 32 + 14 + 8;
    // The phone's menu after a gap-2; on the desktop the +1 after its gap-2, and without hover the
    // icon buttons after another gap-2, with gap-0.5 between them (with hover they float over the title)
    const icons = !canHover ? 8 + (shape.hasSteps(node.id) ? 3 : 2) * (iconSize + 2) - 2 : 0;
    const buttons = shape.phone ? 8 + phoneMenuWidth : 8 + labelWidth(plusOneButton, "+1") + icons;
    return { text: node.title, className: questTitleType, width: width - fixed - buttons };
  }
  if (shape.folded(node.id)) return null;
  // px-3, the tick (w-4), the gap-2.5 on each side of the title, the label slot, and the phone's menu
  const fixed = 24 + 16 + 10 + 10 + labelSlot + (shape.phone ? 10 + phoneMenuWidth : 0);
  const holdsSteps = shape.hasSteps(node.id) && !shape.collapsed(node.id);
  return { text: node.title, className: stepTitleType(holdsSteps), width: width - fixed };
}

// --- The phone's camera ---

// On the phone the quests stand in rows, too tall to fit. The zoom makes the widest quest fit the
// screen's short side (never above 1), so a card is the same size on screen upright or on its side;
// rows are as wide as the screen at that zoom, so a phone on its side shows more quests across. The
// view opens on the top; the rest is a scroll away.
export const PHONE_MARGIN = 12;

// Room at the top for the toolbar (+ New quest, Quests) that floats over the canvas
const PHONE_TOOLBAR_HEIGHT = 48;

// rowWidth is the pane's width less the margins. The screen's short side stands in for the width
// upright; a pane narrower than that (the desktop's phone view) is the short side itself.
function phoneZoom(widest: number, rowWidth: number) {
  const shortSide = Math.min(rowWidth, Math.min(window.screen.width, window.screen.height) - 2 * PHONE_MARGIN);
  return Math.min(1, Math.max(zoomRange.min, shortSide / widest));
}

export function phoneViewport(shown: GraphNode[], placements: Record<string, Box>, paneWidth: number) {
  const boxes = shown.flatMap((quest) => (placements[quest.id] ? [placements[quest.id]] : []));
  const left = Math.min(...boxes.map((box) => box.position.x));
  const top = Math.min(...boxes.map((box) => box.position.y));
  const zoom = phoneZoom(Math.max(...boxes.map((box) => box.size.width)), paneWidth - 2 * PHONE_MARGIN);
  return { x: PHONE_MARGIN - left * zoom, y: PHONE_TOOLBAR_HEIGHT + PHONE_MARGIN - top * zoom, zoom };
}

// The phone's camera on one node, at the overview's zoom, a third of the way down the pane; a node
// not laid out (folded away) gives its nearest box that is
export function phoneFocus(id: string, model: GraphModel, placements: Record<string, Box>, zoom: number, paneWidth: number, paneHeight: number) {
  let target: string | null = id;
  while (target && !placements[target]) target = model.byId.get(target)?.parentId ?? null;
  if (!target) return null;
  // Each box sits relative to its parent box
  const corner = { x: 0, y: 0 };
  for (let at: string | null = target; at; at = model.byId.get(at)?.parentId ?? null) {
    corner.x += placements[at]?.position.x ?? 0;
    corner.y += placements[at]?.position.y ?? 0;
  }
  const { size } = placements[target];
  return {
    target,
    viewport: { x: paneWidth / 2 - (corner.x + size.width / 2) * zoom, y: paneHeight / 3 - (corner.y + size.height / 2) * zoom, zoom },
  };
}
