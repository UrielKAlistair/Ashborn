import { expect, test } from "@playwright/test";
import { buildGraphModel } from "../../src/shared/graphModel";
import { emptyKitchen } from "../../src/shared/kitchen";
import { byPriority, deadlinePriority, derivePriorities, prioritisedSteps } from "../../src/shared/priority";
import type { Deadline, GraphEdge, GraphNode, Priority, Snapshot } from "../../src/shared/types";

const today = "2026-11-02";

const node = (id: string, parentId: string | null, fields: Partial<GraphNode> = {}): GraphNode => ({
  id,
  parentId,
  title: id,
  statWeights: {},
  color: null,
  active: true,
  createdAt: "2026-10-20T00:00:00",
  completedAt: null,
  shelved: false,
  priority: null,
  ownXp: 0,
  position: null,
  ...fields,
});
const deadline = (nodeId: string | null, dueDate: string): Deadline => ({ id: `d-${dueDate}`, title: "due", dueDate, alarmTime: null, nodeId });

function setup(nodes: GraphNode[], edges: GraphEdge[] = [], deadlines: Deadline[] = []) {
  const snapshot = {
    nodes,
    edges,
    deadlines,
    routines: [],
    routineChecks: [],
    alarms: [],
    progressToday: { date: today, count: 0 },
    kitchen: emptyKitchen,
    settings: { dayStartHour: 4, timeZone: null },
    inboxId: "user",
  } as unknown as Snapshot;
  const model = buildGraphModel(snapshot);
  return { snapshot, model, priorities: derivePriorities(model, snapshot, today) };
}
const asObject = (map: Map<string, Priority>) => Object.fromEntries(map);

// quest: a → b → c, and a separate step d
const chain = (cPriority: Priority | null, done: string[] = []) =>
  setup(
    [node("quest", null), ...["a", "b", "c", "d"].map((id) => node(id, "quest", { priority: id === "c" ? cPriority : null, completedAt: done.includes(id) ? "2026-11-01T00:00:00" : null }))],
    [{ from: "a", to: "b" }, { from: "b", to: "c" }],
  );

test("a priority covers the open prerequisites leading to the node, and nothing else", () => {
  expect(asObject(chain(2).priorities.effective)).toEqual({ a: 2, b: 2, c: 2 });
});

test("the walk stops at a done prerequisite", () => {
  expect(asObject(chain(2, ["b"]).priorities.effective)).toEqual({ c: 2 });
});

test("a priority on a box covers the steps inside, at every depth, and what leads to them", () => {
  const { priorities } = setup(
    [node("quest", null, { priority: 3 }), node("box", "quest"), node("deep", "box"), node("before", "box"), node("deeper", "deep")],
    [{ from: "before", to: "deep" }],
  );
  expect(asObject(priorities.effective)).toEqual({ quest: 3, box: 3, deep: 3, before: 3, deeper: 3 });
});

test("where chains meet, the more urgent wins, whichever was walked first", () => {
  const { priorities } = setup(
    [node("quest", null), node("shared", "quest"), node("low", "quest", { priority: 4 }), node("high", "quest", { priority: 1 })],
    [{ from: "shared", to: "low" }, { from: "shared", to: "high" }],
  );
  expect(priorities.effective.get("shared")).toBe(1);
  expect(priorities.effective.get("low")).toBe(4);
});

test("deadline thresholds", () => {
  expect([-3, 0, 1, 2, 3, 4, 7, 8, 14, 15].map(deadlinePriority)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4, null]);
});

test("a linked deadline raises a chain, and the higher of it and the set priority holds", () => {
  const nodes = [node("quest", null), node("a", "quest"), node("b", "quest", { priority: 3 })];
  const edges = [{ from: "a", to: "b" }];
  expect(asObject(setup(nodes, edges, [deadline("b", "2026-11-03")]).priorities.effective)).toEqual({ a: 1, b: 1 });
  expect(asObject(setup(nodes, edges, [deadline("b", "2026-11-30")]).priorities.effective)).toEqual({ a: 3, b: 3 });
  expect(asObject(setup(nodes, edges, [deadline(null, "2026-11-03")]).priorities.effective)).toEqual({ a: 3, b: 3 });
});

test("a deadline linked to a node since deleted does nothing", () => {
  expect(setup([node("quest", null)], [], [deadline("gone", "2026-11-03")]).priorities.effective.size).toBe(0);
});

test("the to-do holds only ready covered steps, grouped most urgent first", () => {
  const { model, snapshot, priorities } = setup(
    [node("quest", null), node("a", "quest"), node("b", "quest", { priority: 2 }), node("free", "quest"), node("urgent", "quest", { priority: 1 }), node("shelved", "quest", { priority: 1, shelved: true })],
    [{ from: "a", to: "b" }],
  );
  const todo = prioritisedSteps(model, snapshot, priorities);
  expect(todo.map(({ priority, steps }) => [priority, steps.map(({ id }) => id)])).toEqual([[1, ["urgent"]], [2, ["a"]]]);
});

test("a hidden quest's steps stay off the to-do", () => {
  const { model, snapshot, priorities } = setup([node("quest", null, { active: false }), node("a", "quest", { priority: 1 })]);
  expect(prioritisedSteps(model, snapshot, priorities)).toEqual([]);
});

test("quests and steps sort by the best priority inside them, keeping order among equals", () => {
  const nodes = [node("plain", null), node("second", null), node("deep", "second", { priority: 2 }), node("first", null, { priority: 1 }), node("other", null)];
  const { priorities } = setup(nodes);
  const quests = nodes.filter(({ parentId }) => !parentId);
  expect(byPriority(quests, priorities).map(({ id }) => id)).toEqual(["first", "second", "plain", "other"]);
});

test("each covered node knows where its priority comes from: the node set, or the deadline that raised it", () => {
  const { priorities } = setup(
    [node("q", null), node("a", "q"), node("b", "q", { priority: 2 }), node("c", "q"), node("d", "q")],
    [{ from: "a", to: "b" }, { from: "c", to: "d" }],
    [deadline("d", "2026-11-03")],
  );
  expect(priorities.origin.get("a")).toEqual({ nodeId: "b", deadlineId: null });
  expect(priorities.origin.get("b")).toEqual({ nodeId: "b", deadlineId: null });
  expect(priorities.origin.get("c")).toEqual({ nodeId: "d", deadlineId: "d-2026-11-03" });
});
