import { expect, test } from "@playwright/test";
import { buildGraphModel } from "../../src/shared/graphModel";
import { emptyKitchen } from "../../src/shared/kitchen";
import type { GraphEdge, GraphNode, Snapshot } from "../../src/shared/types";

// A step is ready only once the prerequisites of every box and quest around it are done

const node = (id: string, parentId: string | null, completedAt: string | null = null): GraphNode => ({
  id,
  parentId,
  title: id,
  statWeights: {},
  createdAt: "2026-10-20T00:00:00",
  completedAt,
  shelved: false,
  priority: null,
  ownXp: 0,
  lastActive: "2026-01-01T00:00:00.000Z",
  stamps: {},
});
const ready = (nodes: GraphNode[], edges: GraphEdge[]) =>
  [...buildGraphModel({ nodes, edges, deadlines: [], routines: [], routineChecks: [], alarms: [], kitchen: emptyKitchen } as unknown as Snapshot).ready].sort();

test("a step inside a waiting box waits", () => {
  // quest holds box A (step a1) and box B (step b1); A → B
  const nodes = [node("quest", null), node("A", "quest"), node("a1", "A"), node("B", "quest"), node("b1", "B")];
  expect(ready(nodes, [{ from: "A", to: "B" }])).toEqual(["a1"]);
});

test("the box's steps unlock once its prerequisite is done", () => {
  const done = "2026-11-01T00:00:00";
  const nodes = [node("quest", null), node("A", "quest", done), node("a1", "A", done), node("B", "quest"), node("b1", "B")];
  expect(ready(nodes, [{ from: "A", to: "B" }])).toEqual(["b1"]);
});

test("a quest linked after another holds its steps back", () => {
  const nodes = [node("first", null), node("f1", "first"), node("second", null), node("s1", "second")];
  expect(ready(nodes, [{ from: "first", to: "second" }])).toEqual(["f1"]);
});
