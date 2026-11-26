import { expect, test } from "@playwright/test";
import { today } from "../../src/shared/dates";
import { goneQuiet } from "../../src/shared/goneQuiet";
import { buildGraphModel } from "../../src/shared/graphModel";
import { emptyKitchen } from "../../src/shared/kitchen";
import { derivePriorities } from "../../src/shared/priority";
import type { GraphNode, Snapshot } from "../../src/shared/types";

const date = today();
const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

const node = (id: string, parentId: string | null, lastActive: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  parentId,
  title: id,
  statWeights: {},
  createdAt: daysAgo(90),
  completedAt: null,
  shelved: false,
  priority: null,
  ownXp: 0,
  lastActive,
  stamps: {},
  ...extra,
});

function quiet(nodes: GraphNode[]) {
  const snapshot: Snapshot = {
    nodes,
    edges: [],
    deadlines: [],
    routines: [],
    routineChecks: [],
    alarms: [],
    kitchen: emptyKitchen,
    settings: { timeZone: null },
  };
  const model = buildGraphModel(snapshot);
  return goneQuiet(model, derivePriorities(model, snapshot), date).map(({ quest, days, openSteps }) => [quest.id, days, openSteps]);
}

test("a quest with open steps untouched for a week is quiet, longest first", () => {
  const nodes = [node("week", null, daysAgo(8)), node("a", "week", daysAgo(8)), node("month", null, daysAgo(30)), node("b", "month", daysAgo(30)), node("c", "month", daysAgo(30))];
  expect(quiet(nodes)).toEqual([["month", 30, 2], ["week", 8, 1]]);
});

test("six days isn't quiet; the threshold is seven", () => {
  expect(quiet([node("q", null, daysAgo(6)), node("a", "q", daysAgo(6))])).toEqual([]);
  expect(quiet([node("q", null, daysAgo(7)), node("a", "q", daysAgo(7))]).map(([id]) => id)).toEqual(["q"]);
});

test("a box that groups steps isn't counted as an open step", () => {
  expect(quiet([node("q", null, daysAgo(30)), node("box", "q", daysAgo(30)), node("a", "box", daysAgo(30)), node("b", "box", daysAgo(30))])).toEqual([["q", 30, 2]]);
});

test("activity anywhere inside keeps a quest alive, however deep", () => {
  expect(quiet([node("q", null, daysAgo(30)), node("box", "q", daysAgo(30)), node("deep", "box", daysAgo(1))])).toEqual([]);
  expect(quiet([node("q", null, daysAgo(1)), node("a", "q", daysAgo(30))])).toEqual([]);
});

test("nothing to pick up, or put away already: no open steps, shelved, hidden or done", () => {
  const old = daysAgo(30);
  expect(quiet([node("empty", null, old)])).toEqual([]);
  expect(quiet([node("finished", null, old), node("a", "finished", old, { completedAt: old })])).toEqual([]);
  expect(quiet([node("shelved", null, old, { shelved: true }), node("a", "shelved", old)])).toEqual([]);
  expect(quiet([node("onlyShelved", null, old), node("a", "onlyShelved", old, { shelved: true })])).toEqual([]);
  expect(quiet([node("done", null, old, { completedAt: old }), node("a", "done", old)])).toEqual([]);
});

test("on the to-do or not, a quest untouched is quiet; a P1 after three days, any other after seven", () => {
  const p1 = (days: number) => [node("q", null, daysAgo(days), { priority: 1 }), node("a", "q", daysAgo(days))];
  expect(quiet(p1(2))).toEqual([]);
  expect(quiet(p1(3))).toEqual([["q", 3, 1]]);
  const p2 = (days: number) => [node("q", null, daysAgo(days), { priority: 2 }), node("a", "q", daysAgo(days))];
  expect(quiet(p2(6))).toEqual([]);
  expect(quiet(p2(7))).toEqual([["q", 7, 1]]);
  // A P1 on a step inside makes the quest a P1 one
  expect(quiet([node("q", null, daysAgo(4)), node("a", "q", daysAgo(4), { priority: 1 })])).toEqual([["q", 4, 1]]);
});

test("the most urgent first, then the longest quiet", () => {
  const old = (id: string, days: number, priority: GraphNode["priority"] = null) => [node(id, null, daysAgo(days), { priority }), node(`${id}-step`, id, daysAgo(days))];
  expect(quiet([...old("none", 60), ...old("p3", 10, 3), ...old("p1", 4, 1), ...old("p3old", 20, 3)]).map(([id]) => id)).toEqual(["p1", "p3old", "p3", "none"]);
});
