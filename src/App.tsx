import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyHelp } from "./components/KeyHelp";
import { Navbar } from "./components/Navbar";
import { WindowControls } from "./components/WindowControls";
import { PhoneTabs } from "./components/PhoneTabs";
import { fixPermission, useAlarmPermissions, useAlarmSchedule, useRingingAlarm } from "./lib/alarms";
import { useBackupSchedule } from "./lib/backupSchedule";
import { db } from "./lib/client";
import { usePhone } from "./lib/usePhone";
import { AtlasPage } from "./pages/AtlasPage";
import { requestCapture } from "./pages/home/Capture";
import { HomePage } from "./pages/home/HomePage";
import { KitchenPage } from "./pages/kitchen/KitchenPage";
import { AlarmsPage } from "./pages/AlarmsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AlarmScreen } from "./pages/phone/AlarmScreen";
import { useUndoableChanges, UndoToast } from "./pages/home/UndoToast";
import { onShowOnGraph } from "./pages/home/showOnGraph";
import { storedTimer, storeTimer, useNowMemory, useTimeUpNotice } from "./pages/home/nowStore";
import { NowChoiceContext, useNowMirror } from "./pages/home/nowMirror";
import { buildGraphModel } from "./shared/graphModel";
import { chooseNow } from "./shared/nowStep";
import { derivePriorities, prioritisedSteps } from "./shared/priority";
import { useToday } from "./lib/useToday";
import { PhoneHome } from "./pages/phone/PhoneHome";
import { SignInPage } from "./pages/SignInPage";
import { LeaveDialog } from "./components/LeaveDialog";
import { useSyncedData } from "./lib/useSyncedData";
import { asking, askToLeave, saveForQuit } from "./lib/unsaved";

/**
 * The app: follows the sign-in (SignInPage does the signing in), keeps the user's data in step with
 * the server (useSyncedData), and shows one screen at a time, by the address (or, in the packaged
 * desktop app, in memory). The Atlas shows signed in or not.
 *
 * Around the screens it keeps what every screen shares: the alarm schedule handed to the phone and a
 * ringing alarm shown over everything; the daily desktop backup; the step in Now, chosen once here
 * and mirrored to the tray and the graph; the Undo offer; the desktop's capture shortcut; and the
 * question asked before leaving unsaved work. The layout differs by device: the desktop has the
 * rail (Navbar) and window controls, the phone its tab bar (PhoneTabs) and the Home tabs.
 */
// The packaged desktop app loads its page from a file, where the address is a file path, not a
// route: there the route lives only in memory and every start opens Home
const routesInAddress = window.location.protocol !== "file:";

function App() {
  const [currentPath, setCurrentPath] = useState(routesInAddress ? window.location.pathname || "/" : "/");
  const [userId, setUserId] = useState<string | null | undefined>(undefined); // undefined until the session is read
  const { snapshot, act, offline, queued, error, setError, readAgain, latest } = useSyncedData(userId);
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

  // The screen shown, for putting the address back when Back is refused (unsaved work, kept)
  const shownPath = useRef(currentPath);
  shownPath.current = currentPath;
  useEffect(() => window.ashborn?.onSaveForQuit(saveForQuit), []);

  useEffect(() => {
    const handlePopState = () => {
      // A second Back while the question is on screen waits for its answer, which reads the address then
      if (asking()) return;
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




  const { act: acting, undoable, dismiss } = useUndoableChanges(act, snapshot);
  // Settings' Sync: sends what is queued, reads the data again, then hands the phone its schedule
  const sync = useCallback(async () => {
    await readAgain();
    setSyncs((count) => count + 1);
  }, []);


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

  useTimeUpNotice((stepId) => {
    const step = latest()?.nodes.find(({ id }) => id === stepId);
    return step && !step.completedAt ? step.title : undefined;
  }, Boolean(snapshot));

  // The step in Now on any screen, for the tray's menu and the graph's tag; the card on Home draws this choice
  const nowDate = useToday(snapshot?.settings.dayStartHour ?? 0);
  // A new day moves the reads bounded by date (the Kitchen's days, the last day's ticks and skips), so
  // a window left open across the day start reads again. Not on the first data, whose own hour can move
  // the date the screen started on.
  const dateRead = useRef<string | null>(null);
  useEffect(() => {
    if (dateRead.current && dateRead.current !== nowDate) void readAgain();
    dateRead.current = snapshot ? nowDate : null;
  }, [nowDate, Boolean(snapshot)]);
  const nowMemory = useNowMemory(nowDate);
  // The to-do reads only the graph, so alarms, deadlines, the Kitchen or settings changing leave it be
  const toDo = useMemo(() => {
    if (!snapshot) return null;
    const model = buildGraphModel(snapshot);
    return { model, steps: prioritisedSteps(model, snapshot, derivePriorities(model, snapshot)).flatMap(({ steps }) => steps) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.nodes, snapshot?.edges, snapshot?.inboxId]);
  // A step done anywhere (Now, the graph, another device), deleted, or put away (it or a box above it
  // shelved) ends its timer, as Done in Now does, so its time's-up notice doesn't ring for it. A
  // step split or blocked keeps it.
  useEffect(() => {
    const timer = storedTimer();
    if (!timer || !snapshot) return;
    const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const step = byId.get(timer.stepId);
    let away = !step || Boolean(step.completedAt);
    for (let at = step; at && !away; at = at.parentId ? byId.get(at.parentId) : undefined) away = at.shelved;
    if (away) storeTimer(null);
  }, [snapshot?.nodes]);
  const nowChoice = toDo && chooseNow(toDo.steps, nowMemory, Date.now(), nowDate);
  useNowMirror(toDo && nowChoice ? { id: nowChoice.step.id, title: nowChoice.step.title } : null);

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

      {/* Above the Undo toast while one shows, which would otherwise sit under it */}
      {error && snapshot ? (
        <button
          type="button"
          onClick={() => setError(null)}
          className={`absolute ${undoable ? (phone ? "bottom-36" : "bottom-20") : "bottom-6"} left-1/2 z-50 -translate-x-1/2 rounded-xl border border-red-400/30 bg-card/95 px-4 py-2 text-xs text-red-200`}
        >
          {error} ×
        </button>
      ) : null}
    </main>
  );
}


export default App;
