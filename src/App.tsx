import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyHelp } from "./components/KeyHelp";
import { Navbar } from "./components/Navbar";
import { WindowControls } from "./components/WindowControls";
import { PhoneTabs } from "./components/PhoneTabs";
import { fixPermission, useAlarmPermissions, useAlarmSchedule, useRingingAlarm } from "./lib/alarms";
import { applyDelta, createApi, keepUnchanged } from "./lib/api";
import { BACKUP_NOT_MADE, useBackupSchedule } from "./lib/backupSchedule";
import { api, db } from "./lib/client";
import { watchChanges } from "./lib/live";
import { isConnectionError, mayPass, previewChange, QueueHeld, queueChange, queuedCount, queueUnsent, sendQueue, signInRefused, unqueue, withIds, type QueuedChange } from "./lib/offline";
import { usePhone } from "./lib/usePhone";
import { AtlasPage } from "./pages/AtlasPage";
import { requestCapture } from "./pages/home/Capture";
import { HomePage, type Act } from "./pages/home/HomePage";
import { KitchenPage } from "./pages/kitchen/KitchenPage";
import { AlarmsPage } from "./pages/AlarmsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AlarmScreen } from "./pages/phone/AlarmScreen";
import { useUndoableChanges, UndoToast } from "./pages/home/UndoToast";
import { onShowOnGraph } from "./pages/home/showOnGraph";
import { START_MINUTES, storedTimer, storeTimer, timerBox, useNowMemory, useTimeUpNotice } from "./pages/home/nowStore";
import { NowChoiceContext, useNowMirror } from "./pages/home/nowMirror";
import { buildGraphModel } from "./shared/graphModel";
import { chooseNow } from "./shared/nowStep";
import { derivePriorities, needsFirstStep, prioritisedSteps } from "./shared/priority";
import { useToday } from "./lib/useToday";
import { PhoneHome } from "./pages/phone/PhoneHome";
import { SignInPage } from "./pages/SignInPage";
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from "./shared/dates";
import { emptyKitchen } from "./shared/kitchen";
import type { Delta, Snapshot } from "./shared/types";
import { LeaveDialog } from "./components/LeaveDialog";
import { askToLeave, saveForQuit } from "./lib/unsaved";

// The last data seen, shown when the app starts without a connection
const snapshotStorageKey = "ashborn-snapshot";
// The packaged desktop app loads its page from a file, where the address is a file path, not a
// route: there the route lives only in memory and every start opens Home
const routesInAddress = window.location.protocol !== "file:";
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

function App() {
  const [currentPath, setCurrentPath] = useState(routesInAddress ? window.location.pathname || "/" : "/");
  const [userId, setUserId] = useState<string | null | undefined>(undefined); // undefined until the session is read
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
  const phone = usePhone();
  const [ringing, stopRinging, snoozeRinging] = useRingingAlarm();
  const permissions = useAlarmPermissions();
  // Without these an alarm cannot ring or show, or shows only as a quiet notification, so they are asked
  // for everywhere, the first one missing at a time
  const missingPermission = permissions ? ((["notifications", "exactAlarms", "fullScreen", "alarmChannel"] as const).find((need) => !permissions[need]) ?? null) : null;
  // Each Sync in Settings hands the phone its schedule again, even when the read changed nothing
  const [syncs, setSyncs] = useState(0);
  useAlarmSchedule(snapshot, syncs);
  useBackupSchedule(userId, setError);
  // The data as last updated, ahead of the render that shows it, so a change made straight after
  // another (a tick on a step just added) is checked against it
  const dataRef = useRef(data);
  // The list of changes each running load will replay onto what it read, for `act` to add its answers to
  const loadsRunning = useRef(new Set<Delta[]>());
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  // Reads the data again, as the load below does when the server says something changed; settles once the data is read
  const readAgainRef = useRef(async () => {});

  // The screen shown, for putting the address back when Back is refused (unsaved work, kept)
  const shownPath = useRef(currentPath);
  shownPath.current = currentPath;
  useEffect(() => window.ashborn?.onSaveForQuit(saveForQuit), []);

  useEffect(() => {
    const handlePopState = () => {
      // Once left, the screen follows the address: a Save there may have moved it to what was saved
      void askToLeave().then((leave) => (leave ? setCurrentPath(window.location.pathname || "/") : window.history.pushState({}, "", shownPath.current)));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    void db.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data } = db.auth.onAuthStateChange((_event, session) => setUserId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  // Once signed in: send any changes made offline, load the data, follow changes made
  // elsewhere, and do it again when the connection comes back (the "online" event, or a retry
  // while offline). Without a connection, keep what is on screen, or the last data seen.
  useEffect(() => {
    if (!userId) return;

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
        const loaded = replay(await api.getSnapshot(userId));
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
        const fallback = dataRef.current.confirmed ?? loadCachedSnapshot(userId);
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
  }, [userId]);

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

  const { act: acting, undoable, dismiss } = useUndoableChanges(act, snapshot);
  // Settings' Sync: sends what is queued, reads the data again, then hands the phone its schedule
  const sync = useCallback(async () => {
    await readAgainRef.current();
    setSyncs((count) => count + 1);
  }, []);

  // The device tells the hosted agent server, which runs in UTC, which time zone the user is in
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const storedZone = snapshot?.settings.timeZone;
  useEffect(() => {
    if (snapshot && storedZone !== deviceZone) void act("updateSettings", { timeZone: deviceZone });
  }, [Boolean(snapshot), storedZone, deviceZone]);

  // Leaving a screen with unsaved work asks first (lib/unsaved.ts)
  const navigate = (path: string) => {
    if (path === currentPath) return;
    void askToLeave().then((leave) => {
      if (!leave) return;
      if (routesInAddress) window.history.pushState({}, "", path);
      setCurrentPath(path);
    });
  };

  // The desktop-wide capture shortcut: Home, with the capture field focused
  useEffect(
    () =>
      window.ashborn?.onCapture(() => {
        // Work left unsaved on another screen is asked about first, as leaving it any other way is
        void askToLeave().then((leave) => {
          if (!leave) return;
          if (routesInAddress && window.location.pathname !== "/") window.history.pushState({}, "", "/");
          setCurrentPath("/");
          requestCapture();
        });
      }),
    [],
  );
  // Launched with --capture: the field is focused once it appears (after sign-in, if need be)
  useEffect(() => {
    void window.ashborn?.takeCaptureAtStart().then((take) => {
      if (!take) return;
      setCurrentPath("/");
      requestCapture();
    });
  }, []);

  // On the phone the graph is a tab of its own: asking to show a node opens it there
  useEffect(
    () =>
      phone
        ? onShowOnGraph(() => {
            if (routesInAddress && window.location.pathname !== "/graph") window.history.pushState({}, "", "/graph");
            setCurrentPath("/graph");
          })
        : undefined,
    [phone],
  );

  // Done chosen on the tray's Now, ticked here so it is undoable like any other tick
  const latestActing = useRef(acting);
  latestActing.current = acting;
  useEffect(() => window.ashborn?.onNowDone((id) => void latestActing.current("updateNode", id, { done: true })), []);
  useTimeUpNotice((stepId) => {
    const step = dataRef.current.confirmed?.nodes.find(({ id }) => id === stepId);
    return step && !step.completedAt ? step.title : undefined;
  }, Boolean(snapshot));
  // A step done anywhere (the graph, the tray, another device) ends its timer, as Done in Now does
  useEffect(() => {
    const timer = storedTimer();
    if (timer && snapshot?.nodes.some(({ id, completedAt }) => id === timer.stepId && completedAt)) storeTimer(null);
  }, [snapshot?.nodes]);
  // Start or Stop chosen there sets the step's timer, whichever screen is open
  useEffect(() => window.ashborn?.onNowTimer((id, start) => storeTimer(start ? timerBox(id, START_MINUTES) : null)), []);

  // The step in Now on any screen, for the tray's menu and the graph's tag; the card on Home draws this choice
  const nowDate = useToday(snapshot?.settings.dayStartHour ?? 0);
  // A new day moves the reads bounded by date (the Kitchen's days, the last day's ticks and skips), so
  // a window left open across the day start reads again. Not on the first data, whose own hour can move
  // the date the screen started on.
  const dateRead = useRef<string | null>(null);
  useEffect(() => {
    if (dateRead.current && dateRead.current !== nowDate) void readAgainRef.current();
    dateRead.current = snapshot ? nowDate : null;
  }, [nowDate, Boolean(snapshot)]);
  const nowMemory = useNowMemory(nowDate);
  // The to-do reads only the graph and the deadlines, so alarms, the Kitchen or settings changing leave it be
  const toDo = useMemo(() => {
    if (!snapshot) return null;
    const model = buildGraphModel(snapshot);
    return { model, steps: prioritisedSteps(model, snapshot, derivePriorities(model, snapshot)).flatMap(({ steps }) => steps) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.nodes, snapshot?.edges, snapshot?.inboxId]);
  const nowChoice = toDo && chooseNow(toDo.steps, nowMemory, Date.now(), nowDate);
  useNowMirror(
    toDo && nowChoice
      ? { id: nowChoice.step.id, title: nowChoice.step.title, endsAt: nowChoice.timed?.endsAt ?? null, canTick: !needsFirstStep(toDo.model, nowChoice.step) }
      : null,
  );

  const renderPage = () => {
    if (currentPath === "/atlas" || currentPath.startsWith("/atlas/")) {
      return <AtlasPage currentPath={currentPath} onNavigate={navigate} />;
    }


    if (userId === null) return <SignInPage />;

    if (!snapshot) {
      return (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-3xl border border-ink/10 bg-panel text-sm tracking-[0.16em] text-muted">
          {error ?? "Loading..."}
        </section>
      );
    }

    const away = (() => {
      if (currentPath === "/alarms") return <AlarmsPage snapshot={snapshot} act={acting} />;
      if (currentPath === "/settings") return <SettingsPage permissions={permissions} dayStartHour={snapshot.settings.dayStartHour} act={acting} sync={sync} />;
      if (currentPath === "/kitchen" || currentPath.startsWith("/kitchen/")) {
        const [, , screen, recipeId] = currentPath.split("/");
        return (
          <KitchenPage
            snapshot={snapshot}
            act={acting}
            phone={phone}
            screen={screen === "recipes" ? "recipes" : screen === "stocks" ? "stocks" : "plan"}
            recipeId={recipeId ?? null}
            onNavigate={navigate}
          />
        );
      }
      return null;
    })();

    if (!phone) return away ?? <HomePage snapshot={snapshot} act={acting} />;
    // On the phone the other sections show inside Home, which keeps the graph it built behind them
    const screen = currentPath === "/graph" ? "graph" : currentPath === "/character" ? "character" : "todo";
    return <PhoneHome snapshot={snapshot} act={acting} screen={screen} away={away} />;
  };

  const page = <NowChoiceContext.Provider value={nowChoice}>{renderPage()}</NowChoiceContext.Provider>;

  return (
    <main className="relative h-screen overflow-hidden bg-transparent text-ink">
      {/* The canvas, glowing faintly at the centre in the theme's light */}
      <div className="absolute inset-0 bg-canvas" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_45%,var(--glow),transparent_70%)]" />

      {phone ? (
        <div className="relative flex h-full min-h-0 flex-col">
          {/* On the desktop's phone view, the content starts below the window's title strip */}
          <div className={`flex min-h-0 flex-1 overflow-hidden p-3 ${window.ashborn ? "pt-7" : "pt-[max(0.75rem,env(safe-area-inset-top))]"}`}>{page}</div>
          {userId ? <PhoneTabs currentPath={currentPath} onNavigate={navigate} /> : null}
        </div>
      ) : (
        <div className="relative flex h-full min-h-0">
          {/* The sections need a signed-in user, so the rail waits for one */}
          {userId ? <Navbar currentPath={currentPath} onNavigate={navigate} /> : null}

          <div className="flex min-h-0 flex-1 justify-between gap-6 overflow-hidden p-6">{page}</div>
        </div>
      )}

      {window.ashborn ? <WindowControls /> : null}
      {!phone && userId ? <KeyHelp /> : null}
      <LeaveDialog />

      {undoable ? <UndoToast undoable={undoable} act={act} onDismiss={dismiss} phone={phone} /> : null}

      {ringing ? <AlarmScreen alarm={ringing} onStop={stopRinging} onSnooze={snoozeRinging} /> : null}

      <div className="pointer-events-none absolute top-3 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 [&>*]:pointer-events-auto [&>*]:[-webkit-app-region:no-drag]">
        {missingPermission ? (
          <button
            type="button"
            onClick={fixPermission[missingPermission]}
            className="rounded-lg border border-amber-300/30 bg-card/95 px-3 py-1.5 text-[11px] tracking-[0.1em] text-amber-100"
          >
            {({ notifications: "Allow notifications so alarms can ring", exactAlarms: "Allow alarms and reminders, or none can ring", fullScreen: "Allow alarms over the lock screen", alarmChannel: "Let alarm notifications pop up" } as const)[missingPermission]} →
          </button>
        ) : null}

        {offline ? (
          <p className="rounded-lg border border-amber-300/30 bg-card/95 px-3 py-1 text-[11px] tracking-[0.12em] text-amber-100">
            Offline: {queued > 0 ? `${queued} ${queued === 1 ? "change" : "changes"} will sync when you're back online` : "showing your last data"}
          </p>
        ) : null}
      </div>

      {error && snapshot ? (
        <button
          type="button"
          onClick={() => setError(null)}
          className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-red-400/30 bg-card/95 px-4 py-2 text-xs text-red-200"
        >
          {error} ×
        </button>
      ) : null}
    </main>
  );
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

function loadCachedSnapshot(userId: string): Snapshot | null {
  try {
    const cached = JSON.parse(window.localStorage.getItem(snapshotStorageKey) ?? "null") as Snapshot | null;
    // Saved before the Kitchen, the settings or skipped alarms existed
    return cached && { ...cached, nodes: cached.nodes.map((node) => ({ ...node, stamps: node.stamps ?? {} })), kitchen: cached.kitchen ?? emptyKitchen, skippedAlarms: cached.skippedAlarms ?? [], settings: cached.settings ?? { dayStartHour: DEFAULT_DAY_START_HOUR, timeZone: null }, inboxId: userId };
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

export default App;
