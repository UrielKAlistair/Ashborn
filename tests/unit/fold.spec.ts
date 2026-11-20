import { expect, test } from "@playwright/test";
import { buildGraphModel, isFinished } from "../../src/shared/graphModel";
import { emptyKitchen } from "../../src/shared/kitchen";
import type { GraphNode, Snapshot } from "../../src/shared/types";

// isFinished: a box folds as soon as every step under it is done

const node = (id: string, parentId: string | null, completedAt: string | null): GraphNode => ({
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
  position: null,
});
const model = (nodes: GraphNode[]) =>
  buildGraphModel({
    nodes,
    edges: [],
    routines: [],
    routineChecks: [],
    deadlines: [],
    alarms: [],
    kitchen: emptyKitchen,
    settings: { timeZone: null },
  } satisfies Snapshot);

test("a box folds as soon as its last step is ticked", () => {
  const graph = model([node("q", null, null), node("a", "q", "2026-10-27T15:00:00"), node("b", "q", "2026-10-28T23:59:00")]);
  expect(isFinished(graph, "q")).toBe(true);
});

test("an open step anywhere inside, or no steps at all, never folds", () => {
  const graph = model([node("q", null, null), node("box", "q", null), node("a", "box", "2026-10-20T10:00:00"), node("b", "box", null), node("empty", null, null)]);
  expect(isFinished(graph, "q")).toBe(false);
  expect(isFinished(graph, "box")).toBe(false);
  expect(isFinished(graph, "empty")).toBe(false);
});
