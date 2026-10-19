import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { today } from "../shared/dates";
import { PROGRESS_UNIT } from "../shared/progression";
import type { Delta, Snapshot } from "../shared/types";
import { readProgressToday, toAlarm, toDeadline, toEdge, toNode, toRoutine, type AlarmRow, type DeadlineRow, type NodeRow, type RoutineRow } from "./api";

type Row = Record<string, unknown>;

// Streams changes made anywhere (another device, an agent) into the app as Deltas. The app's own
// changes come back here too, so every Delta is idempotent: merging it twice changes nothing.
// Deleted rows arrive with only their primary key. Returns a function that stops the stream.
export function watchChanges(db: SupabaseClient, current: () => Snapshot | null, onDelta: (delta: Delta) => void) {
  const emit = (delta: Delta | Promise<Delta>) => void Promise.resolve(delta).then(onDelta, () => {});

  const nodeChanged = (row: NodeRow) => {
    // Change rows carry no XP: keep what level-ups logged on the node before
    const before = current()?.nodes.find((node) => node.id === row.id);
    const loggedXp = before ? before.ownXp - (before.completedAt ? PROGRESS_UNIT : 0) : 0;
    const delta: Delta = { nodes: [toNode({ ...row, logged_xp: loggedXp })] };
    // Ticking or unticking elsewhere moves today's count
    if ((before?.completedAt ?? null) !== row.completed_at) {
      return readProgressToday(db).then((progressToday) => ({ ...delta, progressToday }));
    }
    return delta;
  };

  // A level-up elsewhere: re-read the node's XP rather than add to it, so the echo of our own
  // level-up does not count twice
  const levelledUp = async (nodeId: string): Promise<Delta> => {
    const [{ data }, progressToday] = await Promise.all([
      db.from("nodes_with_xp").select().eq("id", nodeId).maybeSingle(),
      readProgressToday(db),
    ]);
    return { nodes: data ? [toNode(data as NodeRow)] : [], progressToday };
  };

  const on = (table: string, handle: (change: RealtimePostgresChangesPayload<Row>) => void) => ({ table, handle });
  const handlers = [
    on("graph_nodes", (change) =>
      emit(change.eventType === "DELETE" ? { removedNodeIds: [change.old.id as string] } : nodeChanged(change.new as NodeRow)),
    ),
    on("graph_edges", (change) =>
      emit(
        change.eventType === "DELETE"
          ? { removedEdges: [toEdge(change.old as { from_id: string; to_id: string })] }
          : { edges: [toEdge(change.new as { from_id: string; to_id: string })] },
      ),
    ),
    on("progress_log", (change) => {
      if (change.eventType === "INSERT") emit(levelledUp(change.new.node_id as string));
    }),
    on("routines", (change) =>
      emit(
        change.eventType === "DELETE"
          ? { removedRoutineIds: [change.old.id as string] }
          : { routines: [toRoutine(change.new as RoutineRow)] },
      ),
    ),
    on("routine_checks", (change) => {
      const row = (change.eventType === "DELETE" ? change.old : change.new) as { routine_id: string; date: string };
      // The app holds only today's checks
      if (row.date === today()) {
        emit({ routineCheck: { routineId: row.routine_id, date: row.date, checked: change.eventType !== "DELETE" } });
      }
    }),
    on("deadlines", (change) => {
      const row = change.new as DeadlineRow;
      emit(
        change.eventType === "DELETE" || row.done_at
          ? { removedDeadlineIds: [(change.eventType === "DELETE" ? change.old.id : row.id) as string] }
          : { deadlines: [toDeadline(row)] },
      );
    }),
    on("alarms", (change) =>
      emit(change.eventType === "DELETE" ? { removedAlarmIds: [change.old.id as string] } : { alarms: [toAlarm(change.new as AlarmRow)] }),
    ),
  ];

  const channel = handlers.reduce(
    (channel, { table, handle }) => channel.on("postgres_changes", { event: "*", schema: "public", table }, handle),
    db.channel("ashborn-changes"),
  );
  channel.subscribe();

  return () => void db.removeChannel(channel);
}
