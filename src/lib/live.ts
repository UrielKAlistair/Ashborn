/**
 * Live sync: changes made anywhere (another device, the agent) streamed into the app as Deltas, over
 * one Supabase Realtime channel with a handler per table.
 *
 * Three facts about Realtime shape it. The app's own changes come back too, so every Delta is
 * idempotent. A deleted row arrives with only its key. And changes can arrive out of order or be
 * dropped, so a row not on screen is read again before it is shown (see watchChanges). Rows that a
 * change message can't carry whole (a node's XP, the Kitchen's many tables) are re-read instead.
 */
import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { addDays, today } from "../shared/dates";
import { PROGRESS_UNIT } from "../shared/progression";
import type { Delta, Snapshot } from "../shared/types";
import { readKitchen, readSettings, toAlarm, toDeadline, toEdge, toEvent, toNode, toRoutine, type AlarmRow, type DeadlineRow, type EventRow, type NodeRow, type RoutineRow } from "./api";
import { isConnectionError } from "./offline";

type Row = Record<string, unknown>;
type EdgeRow = { from_id: string; to_id: string };

// Kitchen changes arrive as bursts (cooking a meal writes the meal and a change per ingredient), and
// a deleted row carries only its key, so any of them re-reads the whole Kitchen once the burst is over
const kitchenTables = ["stock_items", "stock_changes", "recipes", "recipe_ingredients", "recipe_reminders", "meals", "meal_recipes", "default_meals", "default_meal_recipes"];
const KITCHEN_SETTLE_MS = 300;

// Starts the stream; returns a function that stops it. onSubscribed fires each time the server starts
// listening, when the caller should read everything again. Changes do not always arrive in the order they were made: a delete can come before the insert or
// update it followed (Realtime checks access on those first), and that insert can be dropped. So an
// insert or update of a row not on screen is read again first, and shown only if the row exists,
// lest it bring back a row already deleted.
export function watchChanges(db: SupabaseClient, current: () => Snapshot | null, onDelta: (delta: Delta) => void, onSubscribed: () => void) {
  // A change whose read failed on the network is left to the next read; any other failure is reported
  const emit = (delta: Delta | Promise<Delta>) =>
    void Promise.resolve(delta)
      .then(onDelta)
      .catch((reason) => {
        if (!isConnectionError(reason)) console.error("A live change could not be shown", reason);
      });

  // What a read found, unless a newer read of the same thing has started: reads can finish out of order
  const startedReads = new Map<string, number>();
  const latest = (key: string, read: PromiseLike<Delta>): Promise<Delta> => {
    const started = (startedReads.get(key) ?? 0) + 1;
    startedReads.set(key, started);
    return Promise.resolve(read).then((delta) => (startedReads.get(key) === started ? delta : {}));
  };
  // A row deleted: a read of it still on its way would bring it back, so its result is dropped
  const deleted = (key: string, delta: Delta) => {
    startedReads.set(key, (startedReads.get(key) ?? 0) + 1);
    emit(delta);
  };

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
    return { nodes: [toNode({ ...row, logged_xp: loggedXp })] };
  };

  // The node with its XP as stored. A level-up elsewhere re-reads it rather than adding to it, so
  // the echo of our own level-up does not count twice.
  const readXp = (nodeId: string) => {
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
      change.eventType === "DELETE" ? deleted(`xp:${change.old.id}`, { removedNodeIds: [change.old.id as string] }) : emit(nodeChanged(change.new as NodeRow)),
    ),
    on("graph_edges", (change) => {
      if (change.eventType === "DELETE") return deleted(`edge:${change.old.from_id}:${change.old.to_id}`, { removedEdges: [toEdge(change.old as EdgeRow)] });
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
      if (change.eventType === "DELETE") return deleted(`routine:${change.old.id}`, { removedRoutineIds: [change.old.id as string] });
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
      // The app holds the checks from yesterday on, as the load reads them: the phone's schedule reaches back that far
      if (row.date >= addDays(today(), -1)) {
        emit({ routineCheck: { routineId: row.routine_id, date: row.date, checked: change.eventType !== "DELETE" && row.checked !== false } });
      }
    }),
    on("deadlines", (change) => {
      const row = change.new as DeadlineRow;
      if (change.eventType === "DELETE" || row.done_at) {
        const id = (change.eventType === "DELETE" ? change.old.id : row.id) as string;
        return deleted(`deadline:${id}`, { removedDeadlineIds: [id] });
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
      if (change.eventType === "DELETE") return deleted(`alarm:${change.old.id}`, { removedAlarmIds: [change.old.id as string] });
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
    on("events", (change) => {
      if (change.eventType === "DELETE") return deleted(`event:${change.old.id}`, { removedEventIds: [change.old.id as string] });
      const row = change.new as EventRow;
      emit(
        checked(
          `event:${row.id}`,
          (snapshot) => snapshot.events.some((event) => event.id === row.id),
          row,
          () => db.from("events").select().eq("id", row.id).maybeSingle(),
          (fresh) => ({ events: [toEvent(fresh)] }),
        ),
      );
    }),
    on("alarm_skips", (change) => {
      // The row says whether the ring is skipped; a delete (only the key is sent) unskips it
      const row = (change.eventType === "DELETE" ? change.old : change.new) as { key: string; date?: string; skipped?: boolean };
      emit({ alarmSkip: { key: row.key, date: row.date ?? "", skipped: change.eventType !== "DELETE" && row.skipped !== false } });
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
