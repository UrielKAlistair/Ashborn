import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { today } from "../shared/dates";
import { PROGRESS_UNIT } from "../shared/progression";
import type { Delta, Snapshot } from "../shared/types";
import { readKitchen, readProgressToday, readSettings, toAlarm, toDeadline, toEdge, toNode, toRoutine, type AlarmRow, type DeadlineRow, type NodeRow, type RoutineRow } from "./api";

type Row = Record<string, unknown>;
type EdgeRow = { from_id: string; to_id: string };

// Kitchen changes arrive as bursts (cooking a meal writes the meal and a change per ingredient), and
// a deleted row carries only its key, so any of them re-reads the whole Kitchen once the burst is over
const kitchenTables = ["stock_items", "stock_changes", "recipes", "recipe_ingredients", "recipe_reminders", "meals", "meal_recipes", "default_meals", "default_meal_recipes"];
const KITCHEN_SETTLE_MS = 300;

// Streams changes made anywhere (another device, an agent) into the app as Deltas. The app's own
// changes come back here too, so every Delta is idempotent: merging it twice changes nothing.
// Deleted rows arrive with only their primary key. Returns a function that stops the stream.
// Changes do not always arrive in the order they were made: a delete can come before the insert or
// update it followed (Realtime checks access on those first), and that insert can be dropped. So an
// insert or update of a row not on screen is read again first, and shown only if the row exists,
// lest it bring back a row already deleted.
export function watchChanges(db: SupabaseClient, current: () => Snapshot | null, onDelta: (delta: Delta) => void, onSubscribed: () => void) {
  const emit = (delta: Delta | Promise<Delta>) =>
    void Promise.resolve(delta)
      .then(onDelta)
      .catch((reason) => console.error("A live change could not be shown", reason));

  // What a read found, unless a newer read of the same thing has started: reads can finish out of order
  const startedReads = new Map<string, number>();
  const latest = (key: string, read: PromiseLike<Delta>): Promise<Delta> => {
    const started = (startedReads.get(key) ?? 0) + 1;
    startedReads.set(key, started);
    return Promise.resolve(read).then((delta) => (startedReads.get(key) === started ? delta : {}));
  };
  const emitProgress = () => emit(latest("progress", readProgressToday(db).then((progressToday) => ({ progressToday }))));

  // A row's change as it arrived if the row is on screen, or as it is now in the database
  const checked = <R>(key: string, onScreen: (snapshot: Snapshot) => boolean, row: R, read: () => PromiseLike<{ data: unknown }>, toDelta: (row: R) => Delta) => {
    const snapshot = current();
    if (snapshot && onScreen(snapshot)) return toDelta(row);
    return latest(key, Promise.resolve(read()).then(({ data }) => (data ? toDelta(data as R) : {})));
  };

  const nodeChanged = (row: NodeRow) => {
    // Change rows carry no XP: keep what level-ups logged on the node before, or, for a node not on
    // screen, read it (which also tells whether it still exists)
    const snapshot = current();
    const before = snapshot?.nodes.find((node) => node.id === row.id);
    if (!before) return readXp(row.id);
    const loggedXp = before.ownXp - (before.completedAt ? PROGRESS_UNIT : 0);
    // Ticking or unticking elsewhere moves today's count
    if (before.completedAt !== row.completed_at) emitProgress();
    return { nodes: [toNode({ ...row, logged_xp: loggedXp })] };
  };

  // The node with its XP as stored. A level-up elsewhere re-reads it rather than adding to it, so
  // the echo of our own level-up does not count twice.
  const readXp = (nodeId: string) => {
    emitProgress();
    const read = db.from("nodes_with_xp").select().eq("id", nodeId).maybeSingle();
    return latest(`xp:${nodeId}`, Promise.resolve(read).then(({ data }) => ({ nodes: data ? [toNode(data as NodeRow)] : [] })));
  };

  let kitchenTimer: ReturnType<typeof setTimeout> | undefined;
  const kitchenChanged = () => {
    clearTimeout(kitchenTimer);
    kitchenTimer = setTimeout(() => emit(latest("kitchen", readKitchen(db).then((kitchen) => ({ kitchen })))), KITCHEN_SETTLE_MS);
  };

  const on = (table: string, handle: (change: RealtimePostgresChangesPayload<Row>) => void) => ({ table, handle });
  const handlers = [
    on("graph_nodes", (change) =>
      emit(change.eventType === "DELETE" ? { removedNodeIds: [change.old.id as string] } : nodeChanged(change.new as NodeRow)),
    ),
    on("graph_edges", (change) => {
      if (change.eventType === "DELETE") return emit({ removedEdges: [toEdge(change.old as EdgeRow)] });
      const row = change.new as EdgeRow;
      emit(
        checked(
          `edge:${row.from_id}:${row.to_id}`,
          (snapshot) => snapshot.edges.some((edge) => edge.from === row.from_id && edge.to === row.to_id),
          row,
          () => db.from("graph_edges").select("from_id, to_id").eq("from_id", row.from_id).eq("to_id", row.to_id).maybeSingle(),
          (fresh) => ({ edges: [toEdge(fresh)] }),
        ),
      );
    }),
    on("progress_log", (change) => {
      if (change.eventType === "INSERT") emit(readXp(change.new.node_id as string));
    }),
    on("routines", (change) => {
      if (change.eventType === "DELETE") return emit({ removedRoutineIds: [change.old.id as string] });
      const row = change.new as RoutineRow;
      emit(
        checked(
          `routine:${row.id}`,
          (snapshot) => snapshot.routines.some((routine) => routine.id === row.id),
          row,
          () => db.from("routines").select().eq("id", row.id).maybeSingle(),
          (fresh) => ({ routines: [toRoutine(fresh)] }),
        ),
      );
    }),
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
      if (change.eventType === "DELETE" || row.done_at) {
        return emit({ removedDeadlineIds: [(change.eventType === "DELETE" ? change.old.id : row.id) as string] });
      }
      emit(
        checked(
          `deadline:${row.id}`,
          (snapshot) => snapshot.deadlines.some((deadline) => deadline.id === row.id),
          row,
          () => db.from("deadlines").select().eq("id", row.id).is("done_at", null).maybeSingle(),
          (fresh) => ({ deadlines: [toDeadline(fresh)] }),
        ),
      );
    }),
    on("alarms", (change) => {
      if (change.eventType === "DELETE") return emit({ removedAlarmIds: [change.old.id as string] });
      const row = change.new as AlarmRow;
      emit(
        checked(
          `alarm:${row.id}`,
          (snapshot) => snapshot.alarms.some((alarm) => alarm.id === row.id),
          row,
          () => db.from("alarms").select().eq("id", row.id).maybeSingle(),
          (fresh) => ({ alarms: [toAlarm(fresh)] }),
        ),
      );
    }),
    ...kitchenTables.map((table) => on(table, kitchenChanged)),
    on("user_settings", () => emit(latest("settings", readSettings(db).then((settings) => ({ settings }))))),
  ];

  const channel = handlers.reduce(
    (channel, { table, handle }) => channel.on("postgres_changes", { event: "*", schema: "public", table }, handle),
    db.channel("ashborn-changes"),
  );
  // Changes made before the server is listening are never sent, on the first join or a rejoin after a
  // dropped connection, so each time it starts listening the data is read again. That moment is this
  // message, which comes up to 1.5 s after subscribe's own SUBSCRIBED.
  channel.on("system", {}, (message: { extension?: string; status?: string }) => {
    if (message.extension === "postgres_changes" && message.status === "ok") onSubscribed();
  });
  channel.subscribe();

  return () => {
    clearTimeout(kitchenTimer);
    void db.removeChannel(channel);
  };
}
