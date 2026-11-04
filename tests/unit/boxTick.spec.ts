import { expect, test } from "@playwright/test";
import { today } from "../../src/shared/dates";
import { openInside } from "../../src/shared/graphModel";
import { emptyKitchen } from "../../src/shared/kitchen";
import { PROGRESS_UNIT } from "../../src/shared/progression";
import type { GraphNode, Snapshot } from "../../src/shared/types";
import { previewChange } from "../../src/lib/offline";

// Ticking a box done means everything in it is done (design 195)

const AT = "2026-11-04T03:00:00.000Z";
const node = (id: string, parentId: string | null, completedAt: string | null = null): GraphNode => ({
  id,
  parentId,
  title: id,
  statWeights: {},
  active: true,
  createdAt: "2026-10-20T00:00:00.000Z",
  completedAt,
  shelved: false,
  priority: null,
  ownXp: completedAt ? PROGRESS_UNIT : 0,
  lastActive: "2026-10-20T00:00:00.000Z",
  stamps: {},
  position: null,
});
// A two-pointer box with a nested box, one step already done and one shelved
const nodes = [
  node("quest", null),
  node("box", "quest"),
  node("a", "box"),
  node("b", "box", "2026-11-01T10:00:00.000Z"),
  { ...node("c", "box"), shelved: true },
  node("inner", "box"),
  node("d", "inner"),
  node("elsewhere", "quest"),
];
const snapshot: Snapshot = {
  nodes,
  edges: [],
  routines: [],
  routineChecks: [],
  deadlines: [],
  alarms: [],
  skippedAlarms: [],
  progressToday: { date: today(), count: 2 },
  kitchen: emptyKitchen,
  settings: { dayStartHour: 4, timeZone: null },
  inboxId: "inbox",
};

test("the open nodes inside a box, at any depth, shelved ones included, done ones and outsiders not", () => {
  expect(openInside(nodes, "box").sort()).toEqual(["a", "c", "d", "inner"]);
  expect(openInside(nodes, "a")).toEqual([]);
});

test("offline, ticking a box shows it and everything open in it done, each counted as progress", () => {
  const delta = previewChange(snapshot, "updateNode", ["box", { done: true }], AT);
  const ticked = new Map(delta.nodes!.map((ticked) => [ticked.id, ticked]));
  expect([...ticked.keys()].sort()).toEqual(["a", "box", "c", "d", "inner"]);
  for (const ticked of delta.nodes!) expect([ticked.completedAt, ticked.ownXp, ticked.lastActive]).toEqual([AT, PROGRESS_UNIT, AT]);
  expect(delta.progressToday).toEqual({ date: today(), count: 2 + 5 });
});

test("offline, unticking a box reopens only the box", () => {
  const done = { ...snapshot, nodes: snapshot.nodes.map((each) => (each.id === "box" ? { ...each, completedAt: AT } : each)) };
  const delta = previewChange(done, "updateNode", ["box", { done: false }], AT);
  expect(delta.nodes!.map(({ id }) => id)).toEqual(["box"]);
});
