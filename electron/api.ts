import { randomUUID } from "node:crypto";
import { today } from "../src/shared/dates.js";
import { PROGRESS_UNIT } from "../src/shared/progression.js";
import type { AshbornApi, GraphNode, ProgressToday, Routine } from "../src/shared/types.js";
import { getDatabase } from "./db/database.js";
import type { DeadlineRow, GraphEdgeRow, GraphNodeRow, RoutineCheckRow, RoutineRow } from "./dbTypes.js";

type Db = ReturnType<typeof getDatabase>;

// Node rows with their own XP: level-ups plus the completion credit
const nodeSelect = `
  SELECT n.id, n.parent_id, n.title, n.stat, n.active, n.created_at, n.completed_at,
    (SELECT COALESCE(SUM(amount), 0) FROM progress_log WHERE node_id = n.id)
      + CASE WHEN n.completed_at IS NULL THEN 0 ELSE ${PROGRESS_UNIT} END AS own_xp
  FROM graph_nodes n
`;

export const api: AshbornApi = {
  getSnapshot() {
    const db = getDatabase();

    return {
      nodes: readNodes(db),
      edges: (db.prepare("SELECT from_id, to_id FROM graph_edges").all() as GraphEdgeRow[]).map((row) => ({
        from: row.from_id,
        to: row.to_id,
      })),
      routines: (db.prepare("SELECT * FROM routines ORDER BY rowid").all() as RoutineRow[]).map(toRoutine),
      routineChecks: (db.prepare("SELECT * FROM routine_checks WHERE date = ?").all(today()) as RoutineCheckRow[]).map(
        (row) => ({ routineId: row.routine_id, date: row.date }),
      ),
      deadlines: (db.prepare("SELECT * FROM deadlines WHERE done_at IS NULL ORDER BY due_date").all() as DeadlineRow[]).map(
        (row) => ({ id: row.id, title: row.title, dueDate: row.due_date }),
      ),
      progressToday: readProgressToday(db),
    };
  },

  createNode(title, parentId) {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare("INSERT INTO graph_nodes (id, parent_id, title, created_at) VALUES (?, ?, ?, ?)").run(
      id,
      parentId,
      title,
      new Date().toISOString(),
    );

    return { nodes: readNodes(db, id) };
  },

  updateNode(id, { title, stat, active, done }) {
    const db = getDatabase();
    const assignments: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (title !== undefined) set("title", title);
    if (stat !== undefined) set("stat", stat);
    if (active !== undefined) set("active", Number(active));
    // Completing stamps the time once; un-completing clears it
    if (done !== undefined) {
      assignments.push(done ? "completed_at = COALESCE(completed_at, ?)" : "completed_at = ?");
      values.push(done ? new Date().toISOString() : null);
    }

    if (assignments.length > 0) {
      db.prepare(`UPDATE graph_nodes SET ${assignments.join(", ")} WHERE id = ?`).run(...values, id);
    }

    return { nodes: readNodes(db, id), progressToday: done !== undefined ? readProgressToday(db) : undefined };
  },

  deleteNode(id) {
    const db = getDatabase();
    // The node and its steps at every depth; the foreign keys cascade the delete to all of them
    const removed = (
      db
        .prepare(`
          WITH RECURSIVE subtree(id) AS (
            SELECT ? UNION ALL SELECT g.id FROM graph_nodes g JOIN subtree s ON g.parent_id = s.id
          )
          SELECT id FROM subtree
        `)
        .all(id) as Array<{ id: string }>
    ).map((row) => row.id);

    db.prepare("DELETE FROM graph_nodes WHERE id = ?").run(id);

    return { removedNodeIds: removed, progressToday: readProgressToday(db) };
  },

  addEdge({ from, to }) {
    const db = getDatabase();

    if (parentOf(db, from) !== parentOf(db, to)) {
      throw new Error("Only nodes in the same box can be linked.");
    }
    if (from === to || reaches(db, to, from)) {
      throw new Error("That link would make a loop.");
    }

    db.prepare("INSERT OR IGNORE INTO graph_edges (from_id, to_id) VALUES (?, ?)").run(from, to);

    return { edges: [{ from, to }] };
  },

  removeEdge(edge) {
    getDatabase().prepare("DELETE FROM graph_edges WHERE from_id = ? AND to_id = ?").run(edge.from, edge.to);

    return { removedEdges: [edge] };
  },

  levelUp(nodeId) {
    const db = getDatabase();
    db.prepare("INSERT INTO progress_log (node_id, amount, logged_at) VALUES (?, ?, ?)").run(
      nodeId,
      PROGRESS_UNIT,
      new Date().toISOString(),
    );

    return { nodes: readNodes(db, nodeId), progressToday: readProgressToday(db) };
  },

  createRoutine({ title, cue, weekdays }) {
    const routine: Routine = { id: randomUUID(), title, cue, weekdays };
    getDatabase()
      .prepare("INSERT INTO routines (id, title, cue, weekdays) VALUES (?, ?, ?, ?)")
      .run(routine.id, title, cue, JSON.stringify(weekdays));

    return { routines: [routine] };
  },

  deleteRoutine(id) {
    getDatabase().prepare("DELETE FROM routines WHERE id = ?").run(id);

    return { removedRoutineIds: [id] };
  },

  toggleRoutine(routineId, date) {
    const db = getDatabase();
    const removed = db.prepare("DELETE FROM routine_checks WHERE routine_id = ? AND date = ?").run(routineId, date);

    if (removed.changes === 0) {
      db.prepare("INSERT INTO routine_checks (routine_id, date) VALUES (?, ?)").run(routineId, date);
    }

    return { routineCheck: { routineId, date, checked: removed.changes === 0 } };
  },

  createDeadline({ title, dueDate }) {
    const id = randomUUID();
    getDatabase().prepare("INSERT INTO deadlines (id, title, due_date) VALUES (?, ?, ?)").run(id, title, dueDate);

    return { deadlines: [{ id, title, dueDate }] };
  },

  completeDeadline(id) {
    getDatabase().prepare("UPDATE deadlines SET done_at = ? WHERE id = ?").run(new Date().toISOString(), id);

    return { removedDeadlineIds: [id] };
  },

  deleteDeadline(id) {
    getDatabase().prepare("DELETE FROM deadlines WHERE id = ?").run(id);

    return { removedDeadlineIds: [id] };
  },
};

// All nodes, or just the one with `id`
function readNodes(db: Db, id?: string): GraphNode[] {
  const rows = (
    id ? db.prepare(`${nodeSelect} WHERE n.id = ?`).all(id) : db.prepare(`${nodeSelect} ORDER BY n.created_at`).all()
  ) as GraphNodeRow[];

  return rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    stat: row.stat,
    active: Boolean(row.active),
    createdAt: row.created_at,
    completedAt: row.completed_at,
    ownXp: row.own_xp,
  }));
}

function toRoutine(row: RoutineRow): Routine {
  return { id: row.id, title: row.title, cue: row.cue, weekdays: JSON.parse(row.weekdays) };
}

// Timestamps are stored in UTC, so the local day is converted to a UTC range first
function readProgressToday(db: Db): ProgressToday {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const range = [start.toISOString(), end.toISOString()];

  const { count } = db
    .prepare(`
      SELECT (SELECT COUNT(*) FROM progress_log WHERE logged_at >= ? AND logged_at < ?)
           + (SELECT COUNT(*) FROM graph_nodes WHERE completed_at >= ? AND completed_at < ?) AS count
    `)
    .get(...range, ...range) as { count: number };

  return { date: today(), count };
}

function parentOf(db: Db, id: string) {
  const row = db.prepare("SELECT parent_id FROM graph_nodes WHERE id = ?").get(id) as { parent_id: string | null } | undefined;

  return row?.parent_id ?? null;
}

// Whether `target` can be reached from `source` along edges
function reaches(db: Db, source: string, target: string) {
  const edges = db.prepare("SELECT from_id, to_id FROM graph_edges").all() as GraphEdgeRow[];
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = next.get(edge.from_id);
    if (targets) targets.push(edge.to_id);
    else next.set(edge.from_id, [edge.to_id]);
  }

  const seen = new Set<string>();
  const stack = [source];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === target) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push(...(next.get(node) ?? []));
  }

  return false;
}
