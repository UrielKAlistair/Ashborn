import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { today } from "../shared/dates";
import { PROGRESS_UNIT } from "../shared/progression";
import type { Alarm, AlarmKind, AshbornApi, Deadline, Delta, GraphEdge, GraphNode, ProgressToday, Routine, Snapshot, StatKey, ThreadColor, Weekday } from "../shared/types";

// The api methods that change data (and so return a Delta)
export type Mutation = {
  [K in keyof AshbornApi]: Awaited<ReturnType<AshbornApi[K]>> extends Delta ? K : never;
}[keyof AshbornApi];

// Rows as Supabase returns them (see supabase/migrations)
export type NodeRow = {
  id: string;
  parent_id: string | null;
  title: string;
  stat: StatKey | null;
  color: ThreadColor | null;
  active: boolean;
  created_at: string;
  completed_at: string | null;
  logged_xp?: number; // only from the nodes_with_xp view
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
};
export type RoutineRow = { id: string; title: string; cue: string; weekdays: Weekday[]; time: string | null; alarm: AlarmKind };
export type AlarmRow = { id: string; label: string; kind: Alarm["kind"]; at: string | null; time: string | null; weekdays: Weekday[]; enabled: boolean };
export type DeadlineRow = { id: string; title: string; due_date: string; done_at: string | null; alarm_time: string | null };

// The data store over Supabase. Nodes are read and written through the nodes_with_xp view so
// each change returns the node with its XP in one round trip.
export function createApi(db: SupabaseClient): AshbornApi {
  const nodes = () => db.from("nodes_with_xp");

  const readNode = async (id: string) => toNode(must(await nodes().select().eq("id", id).single()));

  return {
    async getSnapshot() {
      const [nodeRows, edgeRows, routineRows, checkRows, deadlineRows, alarmRows, progressToday] = await Promise.all([
        nodes().select().order("created_at"),
        db.from("graph_edges").select("from_id, to_id"),
        db.from("routines").select().order("created_at"),
        db.from("routine_checks").select("routine_id, date").eq("date", today()),
        db.from("deadlines").select().is("done_at", null).order("due_date"),
        db.from("alarms").select().or(`at.is.null,at.gt.${new Date().toISOString()}`).order("created_at"),
        readProgressToday(db),
      ]);

      return {
        nodes: must(nodeRows).map(toNode),
        edges: must(edgeRows).map(toEdge),
        routines: must(routineRows).map(toRoutine),
        routineChecks: must(checkRows).map((row) => ({ routineId: row.routine_id, date: row.date })),
        deadlines: must(deadlineRows).map(toDeadline),
        alarms: must(alarmRows).map(toAlarm),
        progressToday,
      };
    },

    async createNode(title, parentId, id) {
      return { nodes: [toNode(must(await nodes().insert({ id, title, parent_id: parentId }).select().single()))] };
    },

    async updateNode(id, { title, stat, color, active, done }) {
      const completed_at = done === undefined ? undefined : done ? new Date().toISOString() : null;
      const node = toNode(must(await nodes().update({ title, stat, color, active, completed_at }).eq("id", id).select().single()));

      return { nodes: [node], progressToday: done === undefined ? undefined : await readProgressToday(db) };
    },

    async deleteNode(id) {
      const removed = must(await db.rpc("delete_node", { target: id })) as string[];

      return { removedNodeIds: removed, progressToday: await readProgressToday(db) };
    },

    async moveNode(id, parentId) {
      const removed = must(await db.rpc("move_node", { target: id, new_parent: parentId })) as Array<{ from_id: string; to_id: string }>;

      return { nodes: [await readNode(id)], removedEdges: removed.map(toEdge) };
    },

    async placeNodes(places) {
      const rows = places.map(({ id, position, size }) => ({ id, ...position, ...size }));
      const placed = must(await db.rpc("place_nodes", { places: rows })) as string[];

      return { nodes: (must(await nodes().select().in("id", placed)) as NodeRow[]).map(toNode) };
    },

    async resetLayout(ids) {
      const rows = must(await nodes().update({ x: null, y: null, width: null, height: null }).in("id", ids).select()) as NodeRow[];

      return { nodes: rows.map(toNode) };
    },

    async addEdge(edge) {
      must(await db.rpc("add_edge", { source_id: edge.from, target_id: edge.to }));

      return { edges: [edge] };
    },

    async removeEdge(edge) {
      must(await db.from("graph_edges").delete().eq("from_id", edge.from).eq("to_id", edge.to));

      return { removedEdges: [edge] };
    },

    async levelUp(nodeId) {
      must(await db.from("progress_log").insert({ node_id: nodeId, amount: PROGRESS_UNIT }));
      const [node, progressToday] = await Promise.all([readNode(nodeId), readProgressToday(db)]);

      return { nodes: [node], progressToday };
    },

    async createRoutine({ title, cue, weekdays, time, alarm }) {
      return { routines: [toRoutine(must(await db.from("routines").insert({ title, cue, weekdays, time, alarm }).select().single()))] };
    },

    async deleteRoutine(id) {
      must(await db.from("routines").delete().eq("id", id));

      return { removedRoutineIds: [id] };
    },

    async toggleRoutine(routineId, date) {
      const removed = must(await db.from("routine_checks").delete().eq("routine_id", routineId).eq("date", date).select());
      if (removed.length === 0) must(await db.from("routine_checks").insert({ routine_id: routineId, date }));

      return { routineCheck: { routineId, date, checked: removed.length === 0 } };
    },

    async createDeadline({ title, dueDate, alarmTime }) {
      const row = must(await db.from("deadlines").insert({ title, due_date: dueDate, alarm_time: alarmTime }).select().single());

      return { deadlines: [toDeadline(row)] };
    },

    async completeDeadline(id) {
      must(await db.from("deadlines").update({ done_at: new Date().toISOString() }).eq("id", id));

      return { removedDeadlineIds: [id] };
    },

    async deleteDeadline(id) {
      must(await db.from("deadlines").delete().eq("id", id));

      return { removedDeadlineIds: [id] };
    },

    async createAlarm(alarm) {
      return { alarms: [toAlarm(must(await db.from("alarms").insert(alarm).select().single()))] };
    },

    async updateAlarm(id, patch) {
      return { alarms: [toAlarm(must(await db.from("alarms").update(patch).eq("id", id).select().single()))] };
    },

    async deleteAlarm(id) {
      must(await db.from("alarms").delete().eq("id", id));

      return { removedAlarmIds: [id] };
    },
  };
}

// Level-ups and completed steps today. Times are stored in UTC, so the local day becomes a range.
export async function readProgressToday(db: SupabaseClient): Promise<ProgressToday> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const [from, to] = [start.toISOString(), end.toISOString()];

  const [levelUps, completions] = await Promise.all([
    db.from("progress_log").select("*", { count: "exact", head: true }).gte("logged_at", from).lt("logged_at", to),
    db.from("graph_nodes").select("*", { count: "exact", head: true }).gte("completed_at", from).lt("completed_at", to),
  ]);

  return { date: today(), count: countOf(levelUps) + countOf(completions) };
}

// A node's own XP: what level-ups logged on it, plus the completion credit once it is done
export function toNode(row: NodeRow): GraphNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    stat: row.stat,
    color: row.color,
    active: row.active,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    ownXp: (row.logged_xp ?? 0) + (row.completed_at ? PROGRESS_UNIT : 0),
    position: row.x === null || row.y === null ? null : { x: row.x, y: row.y },
    size: row.width === null || row.height === null ? null : { width: row.width, height: row.height },
  };
}

export function toEdge(row: { from_id: string; to_id: string }): GraphEdge {
  return { from: row.from_id, to: row.to_id };
}

export function toRoutine(row: RoutineRow): Routine {
  return { id: row.id, title: row.title, cue: row.cue, weekdays: row.weekdays, time: toClock(row.time), alarm: row.alarm };
}

export function toDeadline(row: DeadlineRow): Deadline {
  return { id: row.id, title: row.title, dueDate: row.due_date, alarmTime: toClock(row.alarm_time) };
}

export function toAlarm(row: AlarmRow): Alarm {
  return { id: row.id, label: row.label, kind: row.kind, at: row.at, time: toClock(row.time), weekdays: row.weekdays, enabled: row.enabled };
}

// Postgres gives times as HH:MM:SS
function toClock(time: string | null) {
  return time ? time.slice(0, 5) : null;
}

// Unwraps a Supabase result, turning its error into a thrown one
function must<T>(result: { data: T; error: PostgrestError | null }): NonNullable<T> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T>;
}

function countOf(result: { count: number | null; error: PostgrestError | null }) {
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}

// Merges a change into the data on screen. Lists the change doesn't touch keep their identity.
export function applyDelta(snapshot: Snapshot, delta: Delta): Snapshot {
  const removedNodes = new Set(delta.removedNodeIds);
  const removedEdges = new Set(delta.removedEdges?.map(edgeKey));
  const check = delta.routineCheck;

  return {
    nodes: merge(snapshot.nodes, (node) => node.id, delta.nodes, removedNodes),
    edges:
      removedNodes.size > 0 || removedEdges.size > 0 || delta.edges
        ? merge(
            snapshot.edges.filter((edge) => !removedNodes.has(edge.from) && !removedNodes.has(edge.to)),
            edgeKey,
            delta.edges,
            removedEdges,
          )
        : snapshot.edges,
    routines: merge(snapshot.routines, (routine) => routine.id, delta.routines, new Set(delta.removedRoutineIds)),
    routineChecks: check
      ? [
          ...snapshot.routineChecks.filter((c) => c.routineId !== check.routineId || c.date !== check.date),
          ...(check.checked ? [{ routineId: check.routineId, date: check.date }] : []),
        ]
      : snapshot.routineChecks,
    deadlines: merge(snapshot.deadlines, (deadline) => deadline.id, delta.deadlines, new Set(delta.removedDeadlineIds)),
    alarms: merge(snapshot.alarms, (alarm) => alarm.id, delta.alarms, new Set(delta.removedAlarmIds)),
    progressToday: delta.progressToday ?? snapshot.progressToday,
  };
}

function edgeKey(edge: { from: string; to: string }) {
  return `${edge.from}->${edge.to}`;
}

// Upserts keep their place if present and append if new; removals drop by key
function merge<T>(rows: T[], keyOf: (row: T) => string, upserts: T[] = [], removed = new Set<string>()): T[] {
  if (upserts.length === 0 && removed.size === 0) return rows;

  const byKey = new Map(rows.map((row) => [keyOf(row), row]));
  removed.forEach((key) => byKey.delete(key));
  upserts.forEach((row) => byKey.set(keyOf(row), row));

  return [...byKey.values()];
}
