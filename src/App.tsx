import { useCallback, useEffect, useRef, useState } from "react";
import { Navbar } from "./components/Navbar";
import { PhoneTabs } from "./components/PhoneTabs";
import { fixPermission, useAlarmPermissions, useAlarmSchedule, useRingingAlarm } from "./lib/alarms";
import { applyDelta, createApi } from "./lib/api";
import { useBackupSchedule } from "./lib/backupSchedule";
import { api, db } from "./lib/client";
import { watchChanges } from "./lib/live";
import { isConnectionError, QueueHeld, queueChange, queuedCount, sendQueue } from "./lib/offline";
import { usePhone } from "./lib/usePhone";
import { AtlasPage } from "./pages/AtlasPage";
import { HomePage, type Act } from "./pages/home/HomePage";
import { KitchenPage } from "./pages/kitchen/KitchenPage";
import { AlarmsPage } from "./pages/AlarmsPage";
import { AlarmScreen } from "./pages/phone/AlarmScreen";
import { PhoneHome } from "./pages/phone/PhoneHome";
import { SignInPage } from "./pages/SignInPage";
import { emptyKitchen } from "./shared/kitchen";
import type { Delta, Snapshot } from "./shared/types";

// The last data seen, shown when the app starts without a connection
const snapshotStorageKey = "ashborn-snapshot";
// The packaged desktop app loads its page from a file, where the address is a file path, not a
// route: there the route lives only in memory and every start opens Home
const routesInAddress = window.location.protocol !== "file:";
// How often the app tries the server again while offline: a request can fail while the device
// stays online (a server hiccup), and then no "online" event comes
const OFFLINE_RETRY_MS = 30_000;

function App() {
  const [currentPath, setCurrentPath] = useState(routesInAddress ? window.location.pathname || "/" : "/");
  const [userId, setUserId] = useState<string | null | undefined>(undefined); // undefined until the session is read
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const [queued, setQueued] = useState(queuedCount);
  const [error, setError] = useState<string | null>(null);
  const phone = usePhone();
  const [ringing, stopRinging] = useRingingAlarm();
  const permissions = useAlarmPermissions();
  // Without these two an alarm cannot show at all, so they are asked for everywhere
  const missingPermission = !permissions ? null : !permissions.notifications ? "notifications" : !permissions.fullScreen ? "fullScreen" : null;
  useAlarmSchedule(snapshot);
  useBackupSchedule(userId);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname || "/");

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

    // One load at a time, so two never send the same queued change. Changes streamed in while it
    // runs may be missing from what it reads, so they are kept and replayed onto it in order.
    let loading = false;
    let arrived: Delta[] = [];
    const replay = (snapshot: Snapshot) => arrived.reduce(applyDelta, snapshot);
    const load = async () => {
      if (loading) return;
      loading = true;
      arrived = [];
      try {
        const refused = await sendQueue((at) => createApi(db, () => at));
        setSnapshot(replay(await api.getSnapshot()));
        setOffline(false);
        setQueued(0);
        setError(refused.length > 0 ? `Not saved from offline: ${refused.join("; ")}` : null);
      } catch (reason) {
        if (!isConnectionError(reason)) return setError((reason as Error).message);
        const fallback = snapshotRef.current ?? loadCachedSnapshot();
        if (!fallback) return setError("No connection, and no data saved on this device yet.");
        setSnapshot(replay(fallback));
        setOffline(true);
        setQueued(queuedCount());
        // A server error, not a lost connection, that keeps holding the queue: say what it is
        if (reason instanceof QueueHeld && reason.shown && !/fetch|network/i.test(reason.reason)) setError(`Not synced yet: ${reason.reason}`);
      } finally {
        loading = false;
        arrived = [];
      }
    };
    const retry = () => {
      if (offlineRef.current && document.visibilityState === "visible") void load();
    };

    void load();
    window.addEventListener("online", load);
    document.addEventListener("visibilitychange", retry);
    const retryTimer = window.setInterval(retry, OFFLINE_RETRY_MS);
    const stopWatching = watchChanges(db, () => snapshotRef.current, (delta) => {
      if (loading) arrived.push(delta);
      else setSnapshot((current) => current && applyDelta(current, delta));
    });

    return () => {
      window.removeEventListener("online", load);
      document.removeEventListener("visibilitychange", retry);
      window.clearInterval(retryTimer);
      stopWatching();
    };
  }, [userId]);

  useEffect(() => {
    if (snapshot) cacheSnapshot(snapshot);
  }, [snapshot]);

  const act = useCallback<Act>(
    async (name, ...args) => {
      // The change is stamped when the user makes it, not when it is sent or queued
      const made = new Date();
      // Offline, every change waits for the connection and shows at once; one that could never
      // be accepted is refused now, with the reason
      const queue = () => {
        if (!snapshotRef.current) return false;
        let delta: Delta;
        try {
          delta = queueChange(snapshotRef.current, name, args, made);
        } catch (reason) {
          setError((reason as Error).message);
          return false;
        }
        setSnapshot((current) => current && applyDelta(current, delta));
        setQueued(queuedCount());
        setError(null);
        return true;
      };

      if (offline) return queue();
      try {
        const delta = await (createApi(db, () => made)[name] as (...params: typeof args) => Promise<Delta>)(...args);
        setSnapshot((current) => current && applyDelta(current, delta));
        setError(null);
        return true;
      } catch (reason) {
        if (!isConnectionError(reason)) {
          setError((reason as Error).message);
          return false;
        }
        setOffline(true);
        return queue();
      }
    },
    [offline],
  );

  const navigate = (path: string) => {
    if (path === currentPath) return;

    if (routesInAddress) window.history.pushState({}, "", path);
    setCurrentPath(path);
  };

  const renderPage = () => {
    if (currentPath === "/atlas" || currentPath.startsWith("/atlas/")) {
      return <AtlasPage currentPath={currentPath} onNavigate={navigate} />;
    }


    if (userId === null) return <SignInPage />;

    if (!snapshot) {
      return (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-3xl border border-white/10 bg-night-panel text-sm tracking-[0.16em] text-white/50">
          {error ?? "Loading..."}
        </section>
      );
    }

    if (currentPath === "/alarms") return <AlarmsPage snapshot={snapshot} act={act} permissions={permissions} />;

    if (currentPath === "/kitchen" || currentPath.startsWith("/kitchen/")) {
      const [, , screen, recipeId] = currentPath.split("/");
      return (
        <KitchenPage
          snapshot={snapshot}
          act={act}
          phone={phone}
          screen={screen === "recipes" ? "recipes" : screen === "stocks" ? "stocks" : "plan"}
          recipeId={recipeId ?? null}
          onNavigate={navigate}
        />
      );
    }

    if (!phone) return <HomePage snapshot={snapshot} act={act} />;
    const screen = currentPath === "/graph" ? "graph" : currentPath === "/character" ? "character" : "todo";
    return <PhoneHome snapshot={snapshot} act={act} screen={screen} />;
  };

  return (
    <main className="relative h-screen overflow-hidden bg-transparent text-white">
      {/* The night sky of the homepage's trail: deep blue glowing faintly at the centre */}
      <div className="absolute inset-0 bg-night" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_50%_52%,rgba(20,36,125,0.28),transparent_70%)]" />

      {phone ? (
        <div className="relative flex h-full min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 overflow-hidden p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">{renderPage()}</div>
          <PhoneTabs currentPath={currentPath} onNavigate={navigate} />
        </div>
      ) : (
        <div className="relative flex h-full min-h-0">
          <Navbar currentPath={currentPath} onNavigate={navigate} />

          <div className="flex min-h-0 flex-1 justify-between gap-6 overflow-hidden p-6">{renderPage()}</div>
        </div>
      )}

      {ringing ? <AlarmScreen alarm={ringing} onStop={stopRinging} /> : null}

      <div className="pointer-events-none absolute top-3 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2 [&>*]:pointer-events-auto">
        {missingPermission ? (
          <button
            type="button"
            onClick={fixPermission[missingPermission]}
            className="rounded-lg border border-amber-300/30 bg-night-card/95 px-3 py-1.5 text-[11px] tracking-[0.1em] text-amber-100"
          >
            {missingPermission === "notifications" ? "Allow notifications so alarms can ring" : "Allow alarms over the lock screen"} →
          </button>
        ) : null}

        {offline ? (
          <p className="rounded-lg border border-amber-300/30 bg-night-card/95 px-3 py-1 text-[11px] tracking-[0.12em] text-amber-100">
            Offline: {queued > 0 ? `${queued} ${queued === 1 ? "change" : "changes"} will sync when you're back online` : "showing your last data"}
          </p>
        ) : null}
      </div>

      {error && snapshot ? (
        <button
          type="button"
          onClick={() => setError(null)}
          className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-red-400/30 bg-night-card/95 px-4 py-2 text-xs text-red-200"
        >
          {error} ×
        </button>
      ) : null}
    </main>
  );
}

function loadCachedSnapshot(): Snapshot | null {
  try {
    const cached = JSON.parse(window.localStorage.getItem(snapshotStorageKey) ?? "null") as Snapshot | null;
    // Saved before the Kitchen existed
    return cached && { ...cached, kitchen: cached.kitchen ?? emptyKitchen };
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
