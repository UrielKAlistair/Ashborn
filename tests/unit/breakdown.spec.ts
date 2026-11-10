import { expect, test } from "@playwright/test";
import { breakdownPrompt } from "../../src/shared/breakdown";
import { buildGraphModel } from "../../src/shared/graphModel";
import type { GraphNode, Snapshot } from "../../src/shared/types";

const node = (id: string, parentId: string | null, title: string, fields: Partial<GraphNode> = {}): GraphNode =>
  ({ id, parentId, title, statWeights: {}, createdAt: "2026-10-20T00:00:00", completedAt: null, shelved: false, priority: null, ownXp: 0, lastActive: "", stamps: {}, position: null, ...fields }) as GraphNode;

function setup() {
  const snapshot = {
    nodes: [
      node("q", null, "DDP Work"),
      node("box", "q", "Presentation"),
      node("part1", "box", "Part 1 slides"),
      node("part2", "box", "Part 2 slides"),
      node("outline", "part1", "Outline"),
      node("old", "part1", "Old draft", { completedAt: "2026-11-01T10:00:00" }),
    ],
    edges: [{ from: "part1", to: "part2" }],
    deadlines: [{ id: "d", title: "Show the professor", dueDate: "2026-11-06", alarmTime: null, nodeId: "part1" }],
  } as unknown as Snapshot;
  return { snapshot, model: buildGraphModel(snapshot) };
}

test("names the task, where it sits, what it unlocks, its deadline and the open steps it has", () => {
  const { snapshot, model } = setup();
  const prompt = breakdownPrompt(model, snapshot, "part1");
  expect(prompt).toContain("Task: Part 1 slides");
  expect(prompt).toContain("Part of: DDP Work > Presentation");
  expect(prompt).toContain("Finishing it unlocks: Part 2 slides");
  expect(prompt).toContain("Due: 2026-11-06");
  expect(prompt).toContain("Steps I already have: Outline");
  expect(prompt).not.toContain("Old draft");
  expect(prompt).toMatch(/one per line/);
});

test("a quest has no 'part of' line", () => {
  const { snapshot, model } = setup();
  expect(breakdownPrompt(model, snapshot, "q")).not.toContain("Part of");
});
