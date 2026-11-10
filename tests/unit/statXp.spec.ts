import { expect, test } from "@playwright/test";
import { buildGraphModel } from "../../src/shared/graphModel";
import { emptyKitchen } from "../../src/shared/kitchen";
import type { GraphNode, Snapshot, StatWeights } from "../../src/shared/types";

// Stat XP: each XP in a quest adds weight × XP to each stat the quest trains

const node = (id: string, overrides: Partial<GraphNode>): GraphNode => ({
  id,
  parentId: null,
  title: id,
  statWeights: {},
  createdAt: "2026-10-20T00:00:00Z",
  completedAt: null,
  shelved: false,
  priority: null,
  ownXp: 0,
  lastActive: "2026-01-01T00:00:00.000Z",
  stamps: {},
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
  settings: { dayStartHour: 4, timeZone: null },
  inboxId: "user",
});
const quest = (statWeights: StatWeights, ownXp = 10) => node("quest", { statWeights, ownXp });

test("a weight multiplies the XP; weights are not normalised", () => {
  const model = buildGraphModel(snapshot([quest({ INT: 0.2, CHR: 0.1 }, 100)]));
  expect(model.statXp.INT).toBeCloseTo(20);
  expect(model.statXp.CHR).toBeCloseTo(10);
  expect(model.totalStatXp).toBeCloseTo(30);

  const doubled = buildGraphModel(snapshot([quest({ INT: 2, CHR: 1 }, 100)]));
  expect(doubled.statXp.INT).toBeCloseTo(200);
  expect(doubled.totalStatXp).toBeCloseTo(300);
});

test("weight 1 on one stat is the old single-stat rule", () => {
  const model = buildGraphModel(snapshot([quest({ WIS: 1 }, 40)]));
  expect(model.statXp).toEqual({ STR: 0, DEX: 0, INT: 0, WIS: 40, CHR: 0, MND: 0 });
  expect(model.totalStatXp).toBe(40);
});

test("no weights, or zero weights, train nothing", () => {
  for (const weights of [{}, { INT: 0, MND: 0 }]) {
    const model = buildGraphModel(snapshot([quest(weights)]));
    expect(Object.values(model.statXp)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(model.totalStatXp).toBe(0);
  }
});

test("steps at any depth train their quest's stats, not their own", () => {
  const model = buildGraphModel(
    snapshot([
      quest({ INT: 1.5 }, 10),
      node("step", { parentId: "quest", ownXp: 10, statWeights: { STR: 5 } }),
      node("inner", { parentId: "step", ownXp: 10 }),
      node("other", { statWeights: { MND: 0.5 }, ownXp: 20 }),
    ]),
  );
  expect(model.statXp.INT).toBeCloseTo(45);
  expect(model.statXp.STR).toBe(0);
  expect(model.statXp.MND).toBeCloseTo(10);
  expect(model.totalStatXp).toBeCloseTo(55);
});
