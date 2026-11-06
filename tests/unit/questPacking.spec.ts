import { expect, test } from "@playwright/test";
import { packQuests, prerequisitesFirst, type PackedQuest, type PinnedQuest } from "../../src/shared/questPacking";

const gap = 40;
const canvas = (aspect: number) => ({ width: 1000 * aspect, height: 1000, maxZoom: 1.1 });
const quest = (id: string, width: number, height: number): PackedQuest => ({ id, size: { width, height } });
const pin = (x: number, y: number, width: number, height: number): PinnedQuest => ({ position: { x, y }, size: { width, height } });
const mixed = [quest("a", 240, 90), quest("b", 240, 90), quest("c", 640, 420), quest("d", 300, 180), quest("e", 900, 500), quest("f", 240, 90), quest("g", 420, 330)];

function bounds(rects: PinnedQuest[]) {
  return {
    width: Math.max(...rects.map((r) => r.position.x + r.size.width)),
    height: Math.max(...rects.map((r) => r.position.y + r.size.height)),
  };
}

function expectApart(rects: PinnedQuest[]) {
  rects.forEach((a, i) =>
    rects.slice(i + 1).forEach((b) => {
      const apart =
        a.position.x + a.size.width + gap <= b.position.x ||
        b.position.x + b.size.width + gap <= a.position.x ||
        a.position.y + a.size.height + gap <= b.position.y ||
        b.position.y + b.size.height + gap <= a.position.y;
      expect(apart).toBe(true);
    }),
  );
}

const placed = (loose: PackedQuest[], positions: ReturnType<typeof packQuests>) => loose.map(({ id, size }) => ({ position: positions[id], size }));

test("equal quests spread across a wide screen, not into one column", () => {
  const loose = [quest("a", 280, 228), quest("b", 280, 228), quest("c", 280, 228)];
  const positions = packQuests([], loose, canvas(16 / 9), gap);
  expect(positions.a).toEqual({ x: 0, y: 0 });
  expect(positions.b).toEqual({ x: 320, y: 0 });
});

test("a wider screen gives a wider layout, and nothing touches", () => {
  const wide = placed(mixed, packQuests([], mixed, canvas(16 / 9), gap));
  const tall = placed(mixed, packQuests([], mixed, canvas(0.5), gap));
  expectApart(wide);
  expectApart(tall);
  const ratio = (rects: PinnedQuest[]) => bounds(rects).width / bounds(rects).height;
  expect(ratio(wide)).toBeGreaterThan(ratio(tall));
});

test("given a width narrower than any quest, it keeps to one column as wide as the widest", () => {
  const loose = [quest("a", 280, 100), quest("b", 280, 100), quest("c", 264, 76)];
  const rects = placed(loose, packQuests([], loose, 200, gap));
  expect(bounds(rects).width).toBe(280);
  expect(rects.map((r) => r.position.x)).toEqual([0, 0, 0]);
  expectApart(rects);
});

test("given a width, it fills rows across it, in order", () => {
  const loose = [quest("a", 280, 100), quest("b", 280, 100), quest("c", 264, 76)];
  const rects = placed(loose, packQuests([], loose, 700, gap));
  expect(rects.map((r) => r.position)).toEqual([{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 0, y: 140 }]);
  expect(bounds(rects).width).toBeLessThanOrEqual(700);
  expectApart(rects);
});

test("the rest fill in around a quest the user placed", () => {
  const dragged = pin(300, 200, 280, 228);
  const rects = placed(mixed, packQuests([dragged], mixed, canvas(16 / 9), gap));
  expectApart([dragged, ...rects]);
  // The space to its left and above is still used
  expect(rects.some((r) => r.position.y === 0)).toBe(true);
});

test("three empty quests, all shown at the zoom cap, take two columns, not a column or a row", () => {
  const loose = [quest("a", 264, 76), quest("b", 264, 76), quest("c", 264, 76)];
  const positions = packQuests([], loose, { width: 1306, height: 1030, maxZoom: 1.1 }, gap);
  expect(positions).toEqual({ a: { x: 0, y: 0 }, b: { x: 304, y: 0 }, c: { x: 0, y: 116 } });
});

test("a single quest is simply placed", () => {
  expect(packQuests([], [quest("a", 264, 76)], canvas(16 / 9), gap)).toEqual({ a: { x: 0, y: 0 } });
});

test("zoom decides before shape", () => {
  const big = Array.from({ length: 6 }, (_, i) => quest(`q${i}`, 300, 400));
  const rects = placed(big, packQuests([], big, canvas(16 / 9), gap));
  expectApart(rects);
  // On 1778 x 1000: rows of 3+3 and 4+2 reach the cap and 4+2 is closer in shape; 5+1 (1660 wide)
  // stops at zoom 1.07, the row at 0.89, the column at 0.38
  expect(bounds(rects)).toEqual({ width: 1320, height: 840 });
});

test("a pinned quest above or left of the origin takes no room from the region", () => {
  const loose = [quest("a", 280, 100)];
  expect(packQuests([pin(-400, -300, 280, 100)], loose, canvas(16 / 9), gap).a).toEqual({ x: 0, y: 0 });
});

test("packing is deterministic and keeps the given order at the top left", () => {
  expect(packQuests([], mixed, canvas(16 / 9), gap)).toEqual(packQuests([], mixed, canvas(16 / 9), gap));
  expect(packQuests([], mixed, canvas(16 / 9), gap).a).toEqual({ x: 0, y: 0 });
});

test("prerequisites come first, otherwise the order is kept", () => {
  const ids = (list: { id: string }[]) => list.map(({ id }) => id);
  const quests = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  expect(ids(prerequisitesFirst(quests, []))).toEqual(["a", "b", "c", "d"]);
  expect(ids(prerequisitesFirst(quests, [{ from: "c", to: "a" }]))).toEqual(["c", "a", "b", "d"]);
  // A prerequisite that is not shown is ignored
  expect(ids(prerequisitesFirst(quests, [{ from: "hidden", to: "b" }]))).toEqual(["a", "b", "c", "d"]);
});
