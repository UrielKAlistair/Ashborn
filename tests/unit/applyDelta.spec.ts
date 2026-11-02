import { expect, test } from "@playwright/test";
import { applyDelta } from "../../src/lib/api";
import { emptyKitchen } from "../../src/shared/kitchen";
import type { GraphNode, Snapshot } from "../../src/shared/types";

// Merging a change: what it leaves as it was keeps its identity, and the echo of a change already
// merged changes nothing

const node = (id: string, overrides: Partial<GraphNode> = {}): GraphNode => ({
  id,
  parentId: null,
  title: id,
  statWeights: {},
  color: null,
  active: true,
  createdAt: "2026-10-20T00:00:00Z",
  completedAt: null,
  shelved: false,
  priority: null,
  ownXp: 0,
  lastActive: "2026-01-01T00:00:00.000Z",
  position: null,
  size: null,
  ...overrides,
});
const snapshot: Snapshot = {
  nodes: [node("a"), node("b", { position: { x: 10, y: 20 } })],
  edges: [{ from: "a", to: "b" }],
  routines: [],
  routineChecks: [{ routineId: "r", date: "2026-10-20" }],
  deadlines: [],
  alarms: [],
  progressToday: { date: "2026-10-20", count: 2 },
  kitchen: emptyKitchen,
  settings: { dayStartHour: 4, timeZone: null },
};

test("an echo equal to what is shown returns the snapshot itself", () => {
  const echo = { nodes: [node("b", { position: { x: 10, y: 20 } })], edges: [{ from: "a", to: "b" }], progressToday: { date: "2026-10-20", count: 2 } };
  expect(applyDelta(snapshot, echo)).toBe(snapshot);
  expect(applyDelta(snapshot, { routineCheck: { routineId: "r", date: "2026-10-20", checked: true } })).toBe(snapshot);
  expect(applyDelta(snapshot, { kitchen: { ...emptyKitchen } })).toBe(snapshot);
  expect(applyDelta(snapshot, { removedNodeIds: ["gone"] })).toBe(snapshot);
});

test("a change replaces only the rows it alters", () => {
  const next = applyDelta(snapshot, { nodes: [node("a", { title: "renamed" })] });
  expect(next.nodes[0].title).toBe("renamed");
  expect(next.nodes[1]).toBe(snapshot.nodes[1]);
  expect(next.edges).toBe(snapshot.edges);
  expect(next.routineChecks).toBe(snapshot.routineChecks);
});

test("removing a node drops its edges", () => {
  const next = applyDelta(snapshot, { removedNodeIds: ["b"] });
  expect(next.nodes.map((n) => n.id)).toEqual(["a"]);
  expect(next.edges).toEqual([]);
});
