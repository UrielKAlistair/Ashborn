import { useCallback, useEffect, useRef, useState } from "react";
import { Navbar } from "./components/Navbar";
import { PhoneTabs } from "./components/PhoneTabs";
import { fixPermission, useAlarmPermissions, useAlarmSchedule, useRingingAlarm } from "./lib/alarms";
import { applyDelta } from "./lib/api";
import { api, db } from "./lib/client";
import { watchChanges } from "./lib/live";
import { isConnectionError, queueChange, queuedCount, sendQueue } from "./lib/offline";
import { usePhone } from "./lib/usePhone";
import { AtlasPage } from "./pages/AtlasPage";
import { HomePage, type Act } from "./pages/home/HomePage";
import { AlarmsPage } from "./pages/AlarmsPage";
import { AlarmScreen } from "./pages/phone/AlarmScreen";
import { PhoneHome } from "./pages/phone/PhoneHome";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SignInPage } from "./pages/SignInPage";
import type { Delta, Snapshot } from "./shared/types";

// The last data seen, shown when the app starts without a connection
const snapshotStorageKey = "ashborn-snapshot";

function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname || "/");
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
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

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
  // elsewhere, and do it again when the connection comes back. Without a connection, keep
  // what is on screen, or the last data seen.
  useEffect(() => {
    if (!userId) return;

    const load = async () => {
      try {
        const refused = await sendQueue(api);
        setSnapshot(await api.getSnapshot());
        setOffline(false);
        setQueued(0);
        setError(refused.length > 0 ? `Not saved from offline: ${refused.join("; ")}` : null);
      } catch (reason) {
        if (!isConnectionError(reason)) return setError((reason as Error).message);
        const fallback = snapshotRef.current ?? loadCachedSnapshot();
        if (!fallback) return setError("No connection, and no data saved on this device yet.");
        setSnapshot(fallback);
        setOffline(true);
        setQueued(queuedCount());
      }
    };

    void load();
    window.addEventListener("online", load);
    const stopWatching = watchChanges(db, () => snapshotRef.current, (delta) => setSnapshot((current) => current && applyDelta(current, delta)));

    return () => {
      window.removeEventListener("online", load);
      stopWatching();
    };
  }, [userId]);

  useEffect(() => {
    if (snapshot) cacheSnapshot(snapshot);
  }, [snapshot]);

  const act = useCallback<Act>(
    async (name, ...args) => {
      // Ticks and quick adds wait for the connection and show at once; other changes need it
      const queue = () => {
        const delta = snapshotRef.current && queueChange(snapshotRef.current, name, args);
        if (!delta) return setError("Offline: this change needs a connection.");
        setSnapshot((current) => current && applyDelta(current, delta));
        setQueued(queuedCount());
        setError(null);
      };

      if (offline) return queue();
      try {
        const delta = await (api[name] as (...params: typeof args) => Promise<Delta>)(...args);
        setSnapshot((current) => current && applyDelta(current, delta));
        setError(null);
      } catch (reason) {
        if (!isConnectionError(reason)) return setError((reason as Error).message);
        setOffline(true);
        queue();
      }
    },
    [offline],
  );

  const navigate = (path: string) => {
    if (path === currentPath) return;

    window.history.pushState({}, "", path);
    setCurrentPath(path);
  };

  const renderPage = () => {
    if (currentPath === "/atlas" || currentPath.startsWith("/atlas/")) {
      return <AtlasPage currentPath={currentPath} onNavigate={navigate} />;
    }

    if (currentPath === "/cookbook") return <PlaceholderPage title="Cookbook" />;
    if (currentPath === "/treasury") return <PlaceholderPage title="Treasury" />;

    if (userId === null) return <SignInPage />;

    if (!snapshot) {
      return (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-3xl border border-white/10 bg-night-panel text-sm tracking-[0.16em] text-white/50">
          {error ?? "Loading..."}
        </section>
      );
    }

    if (currentPath === "/alarms") return <AlarmsPage snapshot={snapshot} act={act} permissions={permissions} />;

    return phone ? <PhoneHome snapshot={snapshot} act={act} /> : <HomePage snapshot={snapshot} act={act} />;
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
    return JSON.parse(window.localStorage.getItem(snapshotStorageKey) ?? "null") as Snapshot | null;
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
