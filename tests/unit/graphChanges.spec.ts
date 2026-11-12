import { expect, test } from "@playwright/test";
import { doneAround, openInside } from "../../src/shared/graphModel";
import { emptyKitchen } from "../../src/shared/kitchen";
import { PROGRESS_UNIT } from "../../src/shared/progression";
import type { GraphNode, Snapshot } from "../../src/shared/types";
import { previewChange } from "../../src/lib/offline";

// Graph changes as the server makes them and as they show offline. A box is done exactly when
// everything in it is: ticking it ticks what is open inside (design 195), and a step opened or put
// inside done boxes reopens them (205). A link the server would refuse is refused offline too.

const AT = "2026-11-04T03:00:00.000Z";
const node = (id: string, parentId: string | null, completedAt: string | null = null): GraphNode => ({
  id,
  parentId,
  title: id,
  statWeights: {},
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
  kitchen: emptyKitchen,
  settings: { dayStartHour: 4, timeZone: null },
};

test("the open nodes inside a box, at any depth, shelved ones included, done ones and outsiders not", () => {
  expect(openInside(nodes, "box").sort()).toEqual(["a", "c", "d", "inner"]);
  expect(openInside(nodes, "a")).toEqual([]);
});

test("offline, ticking a box shows it and everything open in it done, each with its XP", () => {
  const delta = previewChange(snapshot, "updateNode", ["box", { done: true }], AT);
  const ticked = new Map(delta.nodes!.map((ticked) => [ticked.id, ticked]));
  expect([...ticked.keys()].sort()).toEqual(["a", "box", "c", "d", "inner"]);
  for (const ticked of delta.nodes!) expect([ticked.completedAt, ticked.ownXp, ticked.lastActive]).toEqual([AT, PROGRESS_UNIT, AT]);
});

test("offline, unticking a box reopens only the box", () => {
  const done = { ...snapshot, nodes: snapshot.nodes.map((each) => (each.id === "box" ? { ...each, completedAt: AT } : each)) };
  const delta = previewChange(done, "updateNode", ["box", { done: false }], AT);
  expect(delta.nodes!.map(({ id }) => id)).toEqual(["box"]);
});

// Everything done: the box, the box inside it and its step
const NOW = new Date().toISOString();
const allDone = { ...snapshot, nodes: snapshot.nodes.map((each) => (["box", "inner", "d"].includes(each.id) ? { ...each, completedAt: NOW, ownXp: PROGRESS_UNIT } : each)) };

test("the done boxes around a node, out to its quest but never the quest", () => {
  expect(doneAround(allDone.nodes, "inner")).toEqual(["inner", "box"]);
  expect(doneAround(allDone.nodes, "quest")).toEqual([]);
  expect(doneAround(allDone.nodes, null)).toEqual([]);
  expect(doneAround(snapshot.nodes, "inner")).toEqual([]);
});

test("offline, reopening a step inside done boxes reopens them, and not its siblings", () => {
  const delta = previewChange(allDone, "updateNode", ["d", { done: false }], AT);
  expect(delta.nodes!.map(({ id, completedAt }) => [id, completedAt])).toEqual([["d", null], ["inner", null], ["box", null]]);
});

test("offline, a step added or moved into a done box reopens it", () => {
  const added = previewChange(allDone, "createNode", ["New problem", "inner", "new"], AT);
  expect(added.nodes!.map(({ id, completedAt }) => [id, completedAt])).toEqual([["new", null], ["inner", null], ["box", null]]);
  const moved = previewChange(allDone, "moveNode", ["elsewhere", "inner"], AT);
  expect(moved.nodes!.map(({ id }) => id)).toEqual(["elsewhere", "inner", "box"]);
  expect(moved.nodes![0].position).toBeNull();
});

test("offline, a link the server would refuse is refused at once: across boxes, or closing a loop", () => {
  const linked = { ...snapshot, edges: [{ from: "a", to: "inner" }] };
  expect(() => previewChange(linked, "addEdge", [{ from: "a", to: "elsewhere" }], AT)).toThrow("Only nodes in the same box can be linked.");
  expect(() => previewChange(linked, "addEdge", [{ from: "inner", to: "a" }], AT)).toThrow("That link would make a loop.");
  expect(() => previewChange(linked, "addEdge", [{ from: "a", to: "a" }], AT)).toThrow("That link would make a loop.");
  expect(previewChange(linked, "addEdge", [{ from: "a", to: "c" }], AT).edges).toEqual([{ from: "a", to: "c" }]);
});
