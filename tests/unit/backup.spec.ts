import { expect, test } from "@playwright/test";
import { consistentBackup } from "../../src/lib/backup";

// A backup read while the app was writing, made into one the database would hold, so a restore
// cannot fail halfway on it

test("a row read twice is kept once", () => {
  const { tables, dropped } = consistentBackup({ routines: [{ id: "r" }, { id: "r" }], routine_checks: [{ routine_id: "r", date: "2026-11-04" }, { routine_id: "r", date: "2026-11-04" }] });
  expect(tables.routines).toEqual([{ id: "r" }]);
  expect(tables.routine_checks).toHaveLength(1);
  expect(dropped).toEqual({ routines: 1, routine_checks: 1 });
});

test("a row whose parent is missing goes, as the database would cascade it, with what hangs from it", () => {
  const { tables, dropped } = consistentBackup({
    graph_nodes: [{ id: "quest", parent_id: null }, { id: "box", parent_id: "deleted" }, { id: "step", parent_id: "box" }],
    graph_edges: [{ from_id: "step", to_id: "quest" }],
    progress_log: [{ id: 1, node_id: "step" }, { id: 2, node_id: "quest" }],
  });
  expect(tables.graph_nodes.map(({ id }) => id)).toEqual(["quest"]);
  expect(tables.graph_edges).toEqual([]);
  expect(tables.progress_log).toEqual([{ id: 2, node_id: "quest" }]);
  expect(dropped).toEqual({ graph_nodes: 2, graph_edges: 1, progress_log: 1 });
});

test("where the database empties the column instead, the row stays with it emptied", () => {
  const { tables, dropped } = consistentBackup({
    graph_nodes: [],
    deadlines: [{ id: "d", node_id: "deleted" }],
    recipes: [{ id: "rice" }],
    recipe_reminders: [{ id: "soak", recipe_id: "rice", anchor_id: "gone" }],
  });
  expect(tables.deadlines).toEqual([{ id: "d", node_id: null }]);
  expect(tables.recipe_reminders).toEqual([{ id: "soak", recipe_id: "rice", anchor_id: null }]);
  expect(dropped).toEqual({});
});
