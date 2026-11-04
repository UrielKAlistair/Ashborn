import { expect, test } from "@playwright/test";
import { addDays, today } from "../../src/shared/dates";
import { goneQuiet } from "../../src/shared/goneQuiet";
import { buildGraphModel } from "../../src/shared/graphModel";
import { emptyKitchen } from "../../src/shared/kitchen";
import { derivePriorities } from "../../src/shared/priority";
import type { Deadline, GraphEdge, GraphNode, Snapshot } from "../../src/shared/types";

const date = today();
const daysAgo = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

const node = (id: string, parentId: string | null, lastActive: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  parentId,
  title: id,
  statWeights: {},
  active: true,
  createdAt: daysAgo(90),
  completedAt: null,
  shelved: false,
  priority: null,
  ownXp: 0,
  lastActive,
  stamps: {},
  position: null,
  ...extra,
});

function quiet(nodes: GraphNode[], edges: GraphEdge[] = [], deadlines: Deadline[] = []) {
  const snapshot: Snapshot = {
    nodes,
    edges,
    deadlines,
    routines: [],
    routineChecks: [],
    alarms: [],
    progressToday: { date, count: 0 },
    kitchen: emptyKitchen,
    settings: { dayStartHour: 4, timeZone: null },
    inboxId: "inbox",
  };
  const model = buildGraphModel(snapshot);
  return goneQuiet(model, snapshot, derivePriorities(model, snapshot), date).map(({ quest, days, openSteps }) => [quest.id, days, openSteps]);
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

test("nothing to pick up, or put away already: no open steps, shelved, hidden, done, or the Inbox", () => {
  const old = daysAgo(30);
  expect(quiet([node("empty", null, old)])).toEqual([]);
  expect(quiet([node("finished", null, old), node("a", "finished", old, { completedAt: old })])).toEqual([]);
  expect(quiet([node("shelved", null, old, { shelved: true }), node("a", "shelved", old)])).toEqual([]);
  expect(quiet([node("onlyShelved", null, old), node("a", "onlyShelved", old, { shelved: true })])).toEqual([]);
  expect(quiet([node("hidden", null, old, { active: false }), node("a", "hidden", old)])).toEqual([]);
  expect(quiet([node("done", null, old, { completedAt: old }), node("a", "done", old)])).toEqual([]);
  expect(quiet([node("inbox", null, old), node("a", "inbox", old)])).toEqual([]);
});

test("a quest on the to-do isn't dropping silently; a priority that reaches nothing ready doesn't save it", () => {
  const old = daysAgo(30);
  expect(quiet([node("q", null, old, { priority: 2 }), node("a", "q", old)])).toEqual([]);
  // The priority sits on a step whose prerequisite is what is ready, so the walk covers that too: on the to-do
  expect(quiet([node("q", null, old), node("a", "q", old), node("b", "q", old, { priority: 2 })], [{ from: "a", to: "b" }])).toEqual([]);
  // A deadline raises nothing, so a near one linked to it leaves it quiet
  const deadline: Deadline = { id: "d", title: "d", dueDate: addDays(date, 1), alarmTime: null, nodeId: "q" };
  expect(quiet([node("q", null, old), node("a", "q", old)], [], [deadline]).map(([id]) => id)).toEqual(["q"]);
});
