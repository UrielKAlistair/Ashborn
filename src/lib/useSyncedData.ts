/**
 * The user's data as the app shows it, kept in step with the server.
 *
 * Two layers: `confirmed`, the data as last settled (loads, replies to changes, changes streamed in
 * from other devices and the agent, and, offline, the queued changes as previewed), and `pending`, the
 * changes made online that are on their way. What is shown is each pending change previewed over the
 * confirmed data, so a change shows at once. A page closing queues what is still pending.
 *
 * - act makes a change: previewed, sent, and its reply merged in; offline, it joins the queue
 *   (offline.ts) and is shown as the server would take it.
 * - The load, once signed in, sends the queue, reads everything, and follows live changes (live.ts);
 *   it runs again when the connection comes back, on a retry while offline, on waking from a long
 *   sleep, and when the server says something changed (readAgain).
 * - The confirmed data is saved on the device, so the app can start without a connection.
 * - The device tells the server its time zone, for the hosted agent.
 * `error` is the notice shown; notices of something not saved stay until dismissed.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Act } from "../pages/home/HomePage";
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from "../shared/dates";
import { emptyKitchen } from "../shared/kitchen";
import type { Delta, Snapshot } from "../shared/types";
import { createApi } from "./api";
import { applyDelta, keepUnchanged } from "./snapshotMerge";
import { BACKUP_NOT_MADE } from "./backupSchedule";
import { api, db } from "./client";
import { watchChanges } from "./live";
import { isConnectionError, mayPass, previewChange, QueueHeld, queueChange, queuedCount, queueUnsent, sendQueue, signInRefused, unqueue, withIds, type QueuedChange } from "./offline";

// The last data seen, shown when the app starts without a connection
const snapshotStorageKey = "ashborn-snapshot";
// Begins the notice for changes the server refused after being queued offline
const NOT_SAVED = "Not saved from offline: ";
// Notices of something not saved (those changes, a backup) stay until dismissed rather than going
// with the next good sync
const lasting = (notice: string | null) => (notice?.startsWith(NOT_SAVED) || notice?.startsWith(BACKUP_NOT_MADE) ? notice : null);
// How often the app tries the server again while offline: a request can fail while the device
// stays online (a server hiccup), and then no "online" event comes
const OFFLINE_RETRY_MS = 30_000;
// Hidden for longer than this (a phone asleep, say), the app reads its data again on coming back
const WAKE_READ_AFTER_MS = 30_000;
// A read again that failed is tried once more after this, before the app calls itself offline
const READ_RETRY_MS = 3000;
// How long the data must stay unchanged before it is saved on the device
const CACHE_SETTLE_MS = 1000;

// A change made online and not yet answered by the server
type Pending = QueuedChange;
// What the server has said (loads, replies, changes streamed in) and the changes still on their way
type Data = { confirmed: Snapshot | null; pending: Pending[] };

export function useSyncedData(userId: string | null | undefined) {
  const [data, setData] = useState<Data>({ confirmed: null, pending: [] });
  // On screen: each change on its way previewed over what the server said, so it shows at once.
  // A preview is made again over every newer confirmed snapshot, so a change made elsewhere
  // meanwhile is kept; one that no longer applies is left out until the server answers.
  const snapshot = useMemo(() => data.confirmed && data.pending.reduce(withPreview, data.confirmed), [data]);
  // today() reads the hour from dates.ts; set it here, before anything below renders with it
  if (snapshot) setDayStartHour(snapshot.settings.dayStartHour);
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(queuedCount);
  const [error, setError] = useState<string | null>(null);
  // The data as last updated, ahead of the render that shows it, so a change made straight after
  // another (a tick on a step just added) is checked against it
  const dataRef = useRef(data);
  // The list of changes each running load will replay onto what it read, for `act` to add its answers to
  const loadsRunning = useRef(new Set<Delta[]>());
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  // Reads the data again, as the load below does when the server says something changed; settles once the data is read
  const readAgainRef = useRef(async () => {});

  // Once signed in, follow the server (followServer below)
  useEffect(
    () => (userId ? followServer({ loadsRunning, dataRef, offlineRef, readAgainRef, confirm, setOffline, setQueued, setError }) : undefined),
    [userId],
  );

  // Saved once the data settles, off the path of the change itself, and at once when the app
  // goes to the background (Android may end a backgrounded app without another event). When the
  // page goes, changes still on their way are queued to be sent at the next start, and saved
  // as shown, as changes made offline are.
  useEffect(() => {
    const confirmed = data.confirmed;
    if (!confirmed) return;
    const save = () => cacheSnapshot(confirmed);
    const saveIfHidden = () => document.visibilityState === "hidden" && save();
    const keepUnsent = () => {
      const { confirmed, pending } = dataRef.current;
      queueUnsent(pending);
      if (confirmed) cacheSnapshot(pending.reduce(withPreview, confirmed));
    };
    const timer = window.setTimeout(save, CACHE_SETTLE_MS);
    document.addEventListener("visibilitychange", saveIfHidden);
    window.addEventListener("pagehide", keepUnsent);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", saveIfHidden);
      window.removeEventListener("pagehide", keepUnsent);
    };
  }, [data.confirmed]);

  const update = (next: Data) => {
    if (next.confirmed === dataRef.current.confirmed && next.pending === dataRef.current.pending) return;
    dataRef.current = next;
    setData(next);
  };
  // Moves the confirmed snapshot on, and with `settled` takes that change off the ones on their
  // way, in one update, so no frame shows both its reply and its preview, or neither
  const confirm = (change: (current: Snapshot | null) => Snapshot | null, settled?: Pending) => {
    const { confirmed, pending } = dataRef.current;
    update({ confirmed: change(confirmed), pending: settled && pending.includes(settled) ? pending.filter((other) => other !== settled) : pending });
  };

  const act = useCallback<Act>(
    async (name, ...args) => {
      // The change is stamped when the user makes it, not when it is sent or queued
      const made = changeMoment();
      const change: Pending = { name, args: withIds(name, args), at: made.toISOString() };
      // Offline, every change waits for the connection; one that could never be accepted is refused
      // now, with the reason. Changes still on their way go into the queue first, in the order made:
      // queued after this one, or left out of what it is checked against, a step just added could be
      // sent after a step put inside it, or a tick of it refused as deleted. A request that gets through
      // after all takes its change off the queue again. Says whether this change was queued.
      const queue = () => {
        const { confirmed, pending } = dataRef.current;
        if (!confirmed) return false;
        const changes = pending.includes(change) ? pending : [...pending, change];
        let next = confirmed;
        const refused: string[] = [];
        let accepted = true;
        for (const each of changes) {
          try {
            const delta = queueChange(next, each.name, each.args, new Date(each.at));
            loadsRunning.current.forEach((arrived) => arrived.push(delta));
            next = applyDelta(next, delta);
          } catch (reason) {
            refused.push((reason as Error).message);
            if (each === change) accepted = false;
          }
        }
        update({ confirmed: next, pending: [] });
        setQueued(queuedCount());
        setError(refused.length > 0 ? refused.join("; ") : lasting);
        return accepted;
      };

      if (offlineRef.current) return queue();
      // Changes still queued go first: sent ahead of them, this one could be undone by an older one
      // arriving after it (a step deleted, then made again by its queued create). It joins them, and
      // they are sent now.
      if (queuedCount() > 0) {
        const queued = queue();
        void readAgainRef.current();
        return queued;
      }
      update({ ...dataRef.current, pending: [...dataRef.current.pending, change] });
      try {
        const delta = await (createApi(db, () => made)[name] as (...params: unknown[]) => Promise<Delta>)(...change.args);
        loadsRunning.current.forEach((arrived) => arrived.push(delta));
        // Queued when the connection went, then through after all: not to be sent again
        if (!dataRef.current.pending.includes(change)) unqueue(change);
        confirm((current) => current && applyDelta(current, delta), change);
        setError(lasting);
        return true;
      } catch (reason) {
        // Queued when the connection went: the queue sends it, or says why it can't
        if (!dataRef.current.pending.includes(change)) return true;
        if (!isConnectionError(reason)) {
          confirm((current) => current, change);
          setError((reason as Error).message);
          return false;
        }
        offlineRef.current = true;
        setOffline(true);
        return queue();
      }
    },
    [],
  );

  // The device tells the hosted agent server, which runs in UTC, which time zone the user is in
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const storedZone = snapshot?.settings.timeZone;
  useEffect(() => {
    if (snapshot && storedZone !== deviceZone) void act("updateSettings", { timeZone: deviceZone });
  }, [Boolean(snapshot), storedZone, deviceZone]);

  const readAgain = useCallback(() => readAgainRef.current(), []);
  return { snapshot, act, offline, queued, error, setError, readAgain };
}

// What followServer works through: the hook's refs and setters
type ServerLink = {
  loadsRunning: { current: Set<Delta[]> };
  dataRef: { current: Data };
  offlineRef: { current: boolean };
  readAgainRef: { current: () => Promise<void> };
  confirm: (change: (current: Snapshot | null) => Snapshot | null, settled?: Pending) => void;
  setOffline: (offline: boolean) => void;
  setQueued: (count: number) => void;
  setError: Dispatch<SetStateAction<string | null>>;
};

// Once signed in: send any changes made offline, load the data, follow changes made
// elsewhere, and do it again when the connection comes back (the "online" event, or a retry
// while offline). Without a connection, keep what is on screen, or the last data seen.
// Returns a function that stops it all.
function followServer({ loadsRunning, dataRef, offlineRef, readAgainRef, confirm, setOffline, setQueued, setError }: ServerLink) {

  // One load at a time, so two never send the same queued change. Changes streamed in or answered
  // while it runs may be missing from what it reads, so they are kept and replayed onto it in order.
  let loading = false;
  let loadAgain = false;
  let arrived: Delta[] = [];
  const replay = (snapshot: Snapshot) => arrived.reduce(applyDelta, snapshot);
  let readRetry = 0;
  // Waiting for the next load to finish, with none to follow it
  let settled: (() => void)[] = [];
  const load = async (quietly = false) => {
    if (loading) return;
    loading = true;
    arrived = [];
    loadsRunning.current.add(arrived);
    // Changes the server refused, gone from the queue: said whatever the read after does
    let refused: string[] = [];
    try {
      refused = await sendQueue((at) => createApi(db, () => at));
      const loaded = replay(await api.getSnapshot());
      // Unchanged rows keep their objects, so reading the same data again draws nothing, and a
      // change redraws only what it touched
      confirm((current) => (current ? keepUnchanged(current, loaded) : loaded));
      setOffline(false);
      // Queued after the queue was sent, while the read ran: the next load sends it
      if (queuedCount() > 0) loadAgain = true;
      setQueued(queuedCount());
      setError((shown) => (refused.length > 0 ? NOT_SAVED + refused.join("; ") : lasting(shown)));
    } catch (reason) {
      // Changes refused before the queue was held have left it too
      if (reason instanceof QueueHeld) refused = [...refused, ...reason.refused];
      if (refused.length > 0) setError(NOT_SAVED + refused.join("; "));
      // A server error that may pass (overloaded, restarting) is waited out as a lost connection is;
      // a sign-in refused is said, since waiting won't mend it
      const connection = isConnectionError(reason);
      if (!connection && (!mayPass(reason) || signInRefused(reason))) {
        const message = (reason as Error).message;
        return setError(refused.length > 0 ? `${NOT_SAVED}${refused.join("; ")}. Also: ${message}` : message);
      }
      // A phone just woken has no radio yet: what is on screen stays until a second try says more
      if (quietly && navigator.onLine && !offlineRef.current && dataRef.current.confirmed) {
        confirm((current) => current && replay(current));
        window.clearTimeout(readRetry);
        readRetry = window.setTimeout(() => void load(), READ_RETRY_MS);
        return;
      }
      const fallback = dataRef.current.confirmed ?? loadCachedSnapshot();
      if (!fallback) {
        // Nothing to show meanwhile, and no offline state to retry from: tried again on the same beat
        window.clearTimeout(readRetry);
        readRetry = window.setTimeout(() => void load(), OFFLINE_RETRY_MS);
        return setError(connection ? "No connection, and no data saved on this device yet." : `Your data can't be read yet (${(reason as Error).message}); trying again.`);
      }
      confirm(() => replay(fallback));
      setOffline(true);
      setQueued(queuedCount());
      // A server error, not a lost connection, that keeps holding the queue: say what it is
      if (reason instanceof QueueHeld && reason.shown && !/fetch|network/i.test(reason.reason) && refused.length === 0) setError(`Not synced yet: ${reason.reason}`);
    } finally {
      loading = false;
      loadsRunning.current.delete(arrived);
      arrived = [];
      if (loadAgain) {
        loadAgain = false;
        void load(true);
      } else settled.splice(0).forEach((resolve) => resolve());
    }
  };
  const retry = () => {
    if (offlineRef.current && document.visibilityState === "visible") void load();
  };
  const loadNow = () => void load();

  // A load under way may have read too early, so it runs again after
  const readAgain = () =>
    new Promise<void>((resolve) => {
      settled.push(resolve);
      if (loading) loadAgain = true;
      else void load(true);
    });
  let hiddenAt = 0;
  const readOnWaking = () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else if (!offlineRef.current && hiddenAt && Date.now() - hiddenAt > WAKE_READ_AFTER_MS) readAgain();
  };

  readAgainRef.current = readAgain;
  void load();
  window.addEventListener("online", loadNow);
  document.addEventListener("visibilitychange", retry);
  document.addEventListener("visibilitychange", readOnWaking);
  const retryTimer = window.setInterval(retry, OFFLINE_RETRY_MS);
  const stopWatching = watchChanges(db, () => dataRef.current.confirmed, (delta) => {
    if (loading) arrived.push(delta);
    else confirm((current) => current && applyDelta(current, delta));
  }, readAgain);

  return () => {
    window.removeEventListener("online", loadNow);
    document.removeEventListener("visibilitychange", retry);
    document.removeEventListener("visibilitychange", readOnWaking);
    window.clearInterval(retryTimer);
    window.clearTimeout(readRetry);
    stopWatching();
    readAgainRef.current = async () => {};
    settled.splice(0).forEach((resolve) => resolve());
  };
}

// Now, but always after the last change: steps added together keep their order by when they were made
let lastChange = 0;
function changeMoment() {
  lastChange = Math.max(Date.now(), lastChange + 1);
  return new Date(lastChange);
}

function withPreview(shown: Snapshot, change: Pending): Snapshot {
  try {
    return applyDelta(shown, previewChange(shown, change.name, change.args, change.at));
  } catch {
    return shown;
  }
}

function loadCachedSnapshot(): Snapshot | null {
  try {
    const cached = JSON.parse(window.localStorage.getItem(snapshotStorageKey) ?? "null") as Snapshot | null;
    // Saved before the Kitchen, the settings, skipped alarms or alarm sounds existed
    return cached && { ...cached, nodes: cached.nodes.map((node) => ({ ...node, stamps: node.stamps ?? {} })), kitchen: cached.kitchen ?? emptyKitchen, skippedAlarms: cached.skippedAlarms ?? [], alarms: cached.alarms.map((alarm) => ({ ...alarm, sound: alarm.sound ?? "default" })), settings: cached.settings ?? { dayStartHour: DEFAULT_DAY_START_HOUR, timeZone: null } };
  } catch {
    return null;
  }
}

function cacheSnapshot(snapshot: Snapshot) {
  try {
    window.localStorage.setItem(snapshotStorageKey, JSON.stringify(snapshot));
  } catch {
    // Storage full or blocked: the app then needs a connection to start
  }
}
