import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { today } from "../shared/dates";
import { PROGRESS_UNIT } from "../shared/progression";
import type { Delta, Snapshot } from "../shared/types";
import { readKitchen, readProgressToday, toAlarm, toDeadline, toEdge, toNode, toRoutine, type AlarmRow, type DeadlineRow, type NodeRow, type RoutineRow } from "./api";

type Row = Record<string, unknown>;

// Kitchen changes arrive as bursts (cooking a meal writes the meal and a change per ingredient), and
// a deleted row carries only its key, so any of them re-reads the whole Kitchen once the burst is over
const kitchenTables = ["stock_items", "stock_changes", "recipes", "recipe_ingredients", "recipe_reminders", "meals", "meal_recipes", "default_meals", "default_meal_recipes"];
const KITCHEN_SETTLE_MS = 300;

// Streams changes made anywhere (another device, an agent) into the app as Deltas. The app's own
// changes come back here too, so every Delta is idempotent: merging it twice changes nothing.
// Deleted rows arrive with only their primary key. Returns a function that stops the stream.
export function watchChanges(db: SupabaseClient, current: () => Snapshot | null, onDelta: (delta: Delta) => void) {
  const emit = (delta: Delta | Promise<Delta>) => void Promise.resolve(delta).then(onDelta, () => {});

  const nodeChanged = (row: NodeRow) => {
    // Change rows carry no XP: keep what level-ups logged on the node before, or, before the first
    // snapshot has loaded, read it
    const snapshot = current();
    if (!snapshot) return readXp(row.id);
    const before = snapshot.nodes.find((node) => node.id === row.id);
    const loggedXp = before ? before.ownXp - (before.completedAt ? PROGRESS_UNIT : 0) : 0;
    const delta: Delta = { nodes: [toNode({ ...row, logged_xp: loggedXp })] };
    // Ticking or unticking elsewhere moves today's count
    if ((before?.completedAt ?? null) !== row.completed_at) {
      return readProgressToday(db).then((progressToday) => ({ ...delta, progressToday }));
    }
    return delta;
  };

  // The node with its XP as stored. A level-up elsewhere re-reads it rather than adding to it, so
  // the echo of our own level-up does not count twice.
  const readXp = async (nodeId: string): Promise<Delta> => {
    const [{ data }, progressToday] = await Promise.all([
      db.from("nodes_with_xp").select().eq("id", nodeId).maybeSingle(),
      readProgressToday(db),
    ]);
    return { nodes: data ? [toNode(data as NodeRow)] : [], progressToday };
  };

  let kitchenTimer: ReturnType<typeof setTimeout> | undefined;
  const kitchenChanged = () => {
    clearTimeout(kitchenTimer);
    kitchenTimer = setTimeout(() => emit(readKitchen(db).then((kitchen) => ({ kitchen }))), KITCHEN_SETTLE_MS);
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
      if (change.eventType === "INSERT") emit(readXp(change.new.node_id as string));
    }),
    on("routines", (change) =>
      emit(
        change.eventType === "DELETE"
          ? { removedRoutineIds: [change.old.id as string] }
          : { routines: [toRoutine(change.new as RoutineRow)] },
      ),
    ),
    on("routine_checks", (change) => {
      // A routine deleted takes its ticks with it; otherwise the row says whether it is ticked
      const row = (change.eventType === "DELETE" ? change.old : change.new) as { routine_id: string; date: string; checked?: boolean };
      // The app holds only today's checks
      if (row.date === today()) {
        emit({ routineCheck: { routineId: row.routine_id, date: row.date, checked: change.eventType !== "DELETE" && row.checked !== false } });
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
    ...kitchenTables.map((table) => on(table, kitchenChanged)),
  ];

  const channel = handlers.reduce(
    (channel, { table, handle }) => channel.on("postgres_changes", { event: "*", schema: "public", table }, handle),
    db.channel("ashborn-changes"),
  );
  channel.subscribe();

  return () => {
    clearTimeout(kitchenTimer);
    void db.removeChannel(channel);
  };
}
