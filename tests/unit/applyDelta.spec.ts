import { expect, test } from "@playwright/test";
import { applyDelta, keepUnchanged } from "../../src/lib/api";
import { emptyKitchen } from "../../src/shared/kitchen";
import { PROGRESS_UNIT } from "../../src/shared/progression";
import type { GraphNode, Snapshot } from "../../src/shared/types";

// Merging a change: what it leaves as it was keeps its identity, the echo of a change already merged
// changes nothing, and an older change doesn't overwrite a newer one

const node = (id: string, overrides: Partial<GraphNode> = {}): GraphNode => ({
  id,
  parentId: null,
  title: id,
  statWeights: {},
  active: true,
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

test("a field keeps the value stamped later, whichever arrives last", () => {
  const stamped = { ...snapshot, nodes: [node("a", { completedAt: null, stamps: { completed_at: "2026-11-03T04:00:02+05:30" } })] };
  const older = node("a", { completedAt: "2026-11-02T22:30:01Z", ownXp: PROGRESS_UNIT, stamps: { completed_at: "2026-11-03T04:00:01+05:30" } });
  expect(applyDelta(stamped, { nodes: [older] })).toBe(stamped);
  const newer = node("a", { completedAt: "2026-11-02T22:30:03Z", stamps: { completed_at: "2026-11-02T22:30:03.123456+00:00" } });
  expect(applyDelta(stamped, { nodes: [newer] }).nodes[0].completedAt).toBe("2026-11-02T22:30:03Z");
});

test("each field is judged by its own stamp", () => {
  const shown = node("a", { title: "new title", priority: null, stamps: { title: "2026-11-03T00:00:05Z", priority: "2026-11-03T00:00:01Z" } });
  const [merged] = applyDelta({ ...snapshot, nodes: [shown] }, { nodes: [node("a", { title: "old title", priority: 2, stamps: { title: "2026-11-03T00:00:02Z", priority: "2026-11-03T00:00:03Z" } })] }).nodes;
  expect(merged).toMatchObject({ title: "new title", priority: 2, stamps: { title: "2026-11-03T00:00:05Z", priority: "2026-11-03T00:00:03Z" } });
});

test("a position is one field, across its two columns", () => {
  const shown = node("a", { position: { x: 1, y: 2 }, stamps: { x: "2026-11-03T00:00:05Z", y: "2026-11-03T00:00:05Z" } });
  const [merged] = applyDelta({ ...snapshot, nodes: [shown] }, { nodes: [node("a", { position: { x: 9, y: 9 }, stamps: { x: "2026-11-03T00:00:06Z", y: "2026-11-03T00:00:01Z" } })] }).nodes;
  expect(merged.position).toEqual({ x: 1, y: 2 });
});

test("equal stamps are one write, so what arrived stands; a missing stamp is oldest", () => {
  const at = "2026-11-03T00:00:05Z";
  const shown = { ...snapshot, nodes: [node("a", { title: "shown", stamps: { title: at } })] };
  expect(applyDelta(shown, { nodes: [node("a", { title: "same stamp", stamps: { title: "2026-11-03T05:30:05+05:30" } })] }).nodes[0].title).toBe("same stamp");
  expect(applyDelta(shown, { nodes: [node("a", { title: "no stamp" })] }).nodes[0].title).toBe("shown");
  const unstamped = { ...snapshot, nodes: [node("a", { title: "shown" })] };
  expect(applyDelta(unstamped, { nodes: [node("a", { title: "no stamp either" })] }).nodes[0].title).toBe("no stamp either");
});

test("XP counts the completion that was kept, and activity only moves forward", () => {
  const shown = node("a", { completedAt: "2026-11-03T00:00:05Z", ownXp: PROGRESS_UNIT + 3, lastActive: "2026-11-03T00:00:05.000Z", stamps: { completed_at: "2026-11-03T00:00:05Z" } });
  const older = node("a", { completedAt: null, ownXp: 3, lastActive: "2026-11-03T00:00:02.000Z", stamps: { completed_at: "2026-11-03T00:00:02Z" } });
  const [merged] = applyDelta({ ...snapshot, nodes: [shown] }, { nodes: [older] }).nodes;
  expect(merged).toMatchObject({ completedAt: "2026-11-03T00:00:05Z", ownXp: PROGRESS_UNIT + 3, lastActive: "2026-11-03T00:00:05.000Z" });
});

test("a snapshot read again keeps the objects of the rows it leaves unchanged", () => {
  const same = structuredClone(snapshot);
  expect(keepUnchanged(snapshot, same)).toBe(snapshot);

  const renamed = structuredClone(snapshot);
  renamed.nodes[1].title = "b, renamed";
  const kept = keepUnchanged(snapshot, renamed);
  expect(kept.nodes[0]).toBe(snapshot.nodes[0]);
  expect(kept.nodes[1]).toEqual(renamed.nodes[1]);
  expect(kept.edges).toBe(snapshot.edges);
  expect(kept.kitchen).toBe(snapshot.kitchen);
  expect(kept.settings).toBe(snapshot.settings);
});
