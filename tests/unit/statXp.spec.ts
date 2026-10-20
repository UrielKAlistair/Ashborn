import { expect, test } from "@playwright/test";
import { buildGraphModel } from "../../src/shared/graphModel";
import { emptyKitchen } from "../../src/shared/kitchen";
import type { GraphNode, Snapshot, StatWeights } from "../../src/shared/types";

// Stat XP: each XP in a thread adds weight × XP to each stat the thread trains

const node = (id: string, overrides: Partial<GraphNode>): GraphNode => ({
  id,
  parentId: null,
  title: id,
  statWeights: {},
  color: null,
  active: true,
  createdAt: "2026-10-20T00:00:00Z",
  completedAt: null,
  shelved: false,
  ownXp: 0,
  position: null,
  size: null,
  ...overrides,
});
const snapshot = (nodes: GraphNode[]): Snapshot => ({
  nodes,
  edges: [],
  routines: [],
  routineChecks: [],
  deadlines: [],
  alarms: [],
  progressToday: { date: "2026-10-20", count: 0 },
  kitchen: emptyKitchen,
});
const thread = (statWeights: StatWeights, ownXp = 10) => node("thread", { statWeights, ownXp });

test("a weight multiplies the XP; weights are not normalised", () => {
  const model = buildGraphModel(snapshot([thread({ INT: 0.2, CHR: 0.1 }, 100)]));
  expect(model.statXp.INT).toBeCloseTo(20);
  expect(model.statXp.CHR).toBeCloseTo(10);
  expect(model.totalStatXp).toBeCloseTo(30);

  const doubled = buildGraphModel(snapshot([thread({ INT: 2, CHR: 1 }, 100)]));
  expect(doubled.statXp.INT).toBeCloseTo(200);
  expect(doubled.totalStatXp).toBeCloseTo(300);
});

test("weight 1 on one stat is the old single-stat rule", () => {
  const model = buildGraphModel(snapshot([thread({ WIS: 1 }, 40)]));
  expect(model.statXp).toEqual({ STR: 0, DEX: 0, INT: 0, WIS: 40, CHR: 0, MND: 0 });
  expect(model.totalStatXp).toBe(40);
});

test("no weights, or zero weights, train nothing", () => {
  for (const weights of [{}, { INT: 0, MND: 0 }]) {
    const model = buildGraphModel(snapshot([thread(weights)]));
    expect(Object.values(model.statXp)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(model.totalStatXp).toBe(0);
  }
});

test("steps at any depth train their thread's stats, not their own", () => {
  const model = buildGraphModel(
    snapshot([
      thread({ INT: 1.5 }, 10),
      node("step", { parentId: "thread", ownXp: 10, statWeights: { STR: 5 } }),
      node("inner", { parentId: "step", ownXp: 10 }),
      node("other", { statWeights: { MND: 0.5 }, ownXp: 20 }),
    ]),
  );
  expect(model.statXp.INT).toBeCloseTo(45);
  expect(model.statXp.STR).toBe(0);
  expect(model.statXp.MND).toBeCloseTo(10);
  expect(model.totalStatXp).toBeCloseTo(55);
});
