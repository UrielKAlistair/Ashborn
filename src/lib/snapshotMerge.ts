// Merging what the server says into the data on screen: a Delta (one change's rows) by applyDelta,
// a whole snapshot read again by keepUnchanged. Both keep every unchanged row as the same object, so
// memoised views draw only what changed. applyDelta also keeps a node's fields shown when the server's
// stamps say they are newer than the ones arriving, which can come late (latestFields).
import { PROGRESS_UNIT } from "../shared/progression";
import type { Delta, GraphNode, Snapshot } from "../shared/types";

// Merges a change into the data on screen. Whatever the change leaves as it was keeps its
// identity, down to the rows, and a change that alters nothing (the echo of our own) returns the
// snapshot itself, so nothing on screen renders again.
export function applyDelta(snapshot: Snapshot, delta: Delta): Snapshot {
  const removedNodes = new Set(delta.removedNodeIds);
  const removedEdges = new Set(delta.removedEdges?.map(edgeKey));
  snapshot.edges.forEach((edge) => (removedNodes.has(edge.from) || removedNodes.has(edge.to)) && removedEdges.add(edgeKey(edge)));
  const check = delta.routineCheck;
  const wasChecked = check && snapshot.routineChecks.some((c) => c.routineId === check.routineId && c.date === check.date);
  const skip = delta.alarmSkip;
  const wasSkipped = skip && snapshot.skippedAlarms.some((s) => s.key === skip.key);

  const next: Snapshot = {
    nodes: merge(snapshot.nodes, (node) => node.id, delta.nodes?.map((node) => latestFields(snapshot.nodes.find(({ id }) => id === node.id), node)), removedNodes),
    edges: merge(snapshot.edges, edgeKey, delta.edges, removedEdges),
    routines: merge(snapshot.routines, (routine) => routine.id, delta.routines, new Set(delta.removedRoutineIds)),
    routineChecks:
      check && check.checked !== wasChecked
        ? [
            ...snapshot.routineChecks.filter((c) => c.routineId !== check.routineId || c.date !== check.date),
            ...(check.checked ? [{ routineId: check.routineId, date: check.date }] : []),
          ]
        : snapshot.routineChecks,
    deadlines: merge(snapshot.deadlines, (deadline) => deadline.id, delta.deadlines, new Set(delta.removedDeadlineIds)),
    alarms: merge(snapshot.alarms, (alarm) => alarm.id, delta.alarms, new Set(delta.removedAlarmIds)),
    skippedAlarms:
      skip && skip.skipped !== wasSkipped
        ? [...snapshot.skippedAlarms.filter((s) => s.key !== skip.key), ...(skip.skipped ? [{ key: skip.key, date: skip.date }] : [])]
        : snapshot.skippedAlarms,
    events: merge(snapshot.events, (event) => event.id, delta.events, new Set(delta.removedEventIds)),
    kitchen: delta.kitchen && !same(delta.kitchen, snapshot.kitchen) ? delta.kitchen : snapshot.kitchen,
    settings: delta.settings && !same(delta.settings, snapshot.settings) ? delta.settings : snapshot.settings,
  };

  return (Object.keys(next) as (keyof Snapshot)[]).every((key) => next[key] === snapshot[key]) ? snapshot : next;
}

// The columns behind each of a node's fields that the server stamps
const STAMPED_FIELDS = [
  ["title", ["title"]],
  ["description", ["description"]],
  ["statWeights", ["stat_weights"]],
  ["completedAt", ["completed_at"]],
  ["shelved", ["shelved"]],
  ["priority", ["priority"]],
  ["parentId", ["parent_id"]],
] as const;

// A node as it arrived, except for fields where what is shown was changed later on the server: changes
// don't always arrive in the order they were made, and the older one must not overwrite the newer.
// Equal stamps are the same write, so what arrived stands. Activity only moves forward.
function latestFields(shown: GraphNode | undefined, arrived: GraphNode): GraphNode {
  if (!shown) return arrived;
  const later = { ...arrived, lastActive: shown.lastActive > arrived.lastActive ? shown.lastActive : arrived.lastActive };
  for (const [field, columns] of STAMPED_FIELDS) {
    if (!columns.some((column) => isOlder(arrived.stamps[column], shown.stamps[column]))) continue;
    Object.assign(later, { [field]: shown[field], stamps: { ...later.stamps, ...Object.fromEntries(columns.map((column) => [column, shown.stamps[column]])) } });
  }
  const logged = arrived.ownXp - (arrived.completedAt ? PROGRESS_UNIT : 0);
  return { ...later, ownXp: logged + (later.completedAt ? PROGRESS_UNIT : 0) };
}

function isOlder(stamp: string | undefined, than: string | undefined) {
  return than !== undefined && (stamp === undefined || Date.parse(stamp) < Date.parse(than));
}

function edgeKey(edge: { from: string; to: string }) {
  return `${edge.from}->${edge.to}`;
}

// Rows are built by the to* readers (or spread from one), so equal rows list their keys in the
// same order and compare equal as JSON
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// A snapshot read again, keeping the objects of `current` wherever a row (or a field holding no
// rows) is unchanged, so memoised views of unchanged rows draw nothing; all unchanged returns `current`
export function keepUnchanged(current: Snapshot, loaded: Snapshot): Snapshot {
  const keyOf = (row: unknown) => (row as { id?: string }).id ?? JSON.stringify(row);
  let changed = false;
  const kept = Object.fromEntries(
    (Object.keys(loaded) as Array<keyof Snapshot>).map((field) => {
      const before = current[field];
      const after = loaded[field];
      if (!Array.isArray(before) || !Array.isArray(after)) {
        if (same(before, after)) return [field, before];
        changed = true;
        return [field, after];
      }
      const byKey = new Map(before.map((row) => [keyOf(row), row]));
      const rows = after.map((row) => {
        const old = byKey.get(keyOf(row));
        return old !== undefined && same(old, row) ? old : row;
      });
      if (rows.length === before.length && rows.every((row, i) => row === before[i])) return [field, before];
      changed = true;
      return [field, rows];
    }),
  ) as Snapshot;
  return changed ? kept : current;
}

// Upserts keep their place if present and append if new; removals drop by key. An upsert equal to
// the row it replaces keeps the row, and a merge that changes nothing returns `rows` itself.
function merge<T>(rows: T[], keyOf: (row: T) => string, upserts: T[] = [], removed = new Set<string>()): T[] {
  if (upserts.length === 0 && removed.size === 0) return rows;

  const byKey = new Map(rows.map((row) => [keyOf(row), row]));
  let changed = false;
  removed.forEach((key) => (changed = byKey.delete(key) || changed));
  upserts.forEach((row) => {
    const key = keyOf(row);
    const before = byKey.get(key);
    if (before !== undefined && same(before, row)) return;
    byKey.set(key, row);
    changed = true;
  });

  return changed ? [...byKey.values()] : rows;
}
