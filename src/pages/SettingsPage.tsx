import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { connectBackgroundRefresh, fixPermission, useHeldSchedule, type AlarmPermissions, type BackgroundEntry } from "../lib/alarms";
import { db } from "../lib/client";
import { currentTimeZone } from "../shared/dates";
import { setTheme, themeNames, themes, useTheme } from "../lib/useTheme";

// How long after the background refresh connects a report that it isn't is taken for one asked before
const CONNECT_SETTLE_MS = 5000;

/**
 * The phone's Settings screen (the desktop has none: its theme switch is on the rail). Four groups:
 * the theme; the hour the day starts (also set from Today's date); Alarm reliability, a checklist of
 * what the phone must allow for alarms to ring on time, each item opening its setting; and Alarms on
 * this phone, what the phone holds, with Sync now. The two alarm groups show only in the Android app
 * (`permissions` is null elsewhere). `sync` reads the data again and hands the phone its schedule.
 */
export function SettingsPage({ permissions, sync }: { permissions: AlarmPermissions | null; sync: () => Promise<void> }) {
  const theme = useTheme();
  return (
    <div className="panel-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
      <Group title="Theme">
        <div role="radiogroup" aria-label="Theme" className="flex gap-1 rounded-xl bg-ink/[0.04] p-1">
          {themes.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={theme === option}
              onClick={() => setTheme(option)}
              className={`min-h-11 flex-1 rounded-lg text-[13px] ${theme === option ? "bg-ember/12 font-medium text-ember ring-1 ring-ember/40" : "text-muted"}`}
            >
              {themeNames[option]}
            </button>
          ))}
        </div>
      </Group>
      {permissions ? (
        <Group title="Alarm reliability">
          <Reliability permissions={permissions} />
        </Group>
      ) : null}
      {permissions ? (
        <Group title="Alarms on this phone">
          <Held sync={sync} />
        </Group>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-2xl border border-ink/8 bg-panel p-4">
      <h2 className="caps font-display text-[13px] font-bold text-ink/90">{title}</h2>
      {children}
    </section>
  );
}

// Each item with a button to its setting. Xiaomi's Autostart cannot be read, so it is offered on
// Xiaomi phones without a tick. The background refresh needs a sign-in of its own, so it asks for
// the password.
function Reliability({ permissions }: { permissions: AlarmPermissions }) {
  // Connected just now, before the phone's next report says so; a report that it isn't wins, unless it
  // comes so soon after that it may have been asked for before
  const [connected, setConnected] = useState(false);
  const connectedAt = useRef(0);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (Date.now() - connectedAt.current > CONNECT_SETTLE_MS) setConnected(false);
  }, [permissions]);
  const background = permissions.background || connected;
  const items = [
    { label: "Notifications allowed", done: permissions.notifications, fix: fixPermission.notifications },
    { label: "Alarms may be set", done: permissions.exactAlarms, fix: fixPermission.exactAlarms },
    { label: "Alarms show over the lock screen", done: permissions.fullScreen, fix: fixPermission.fullScreen },
    { label: "Alarm notifications pop up", done: permissions.alarmChannel, fix: fixPermission.alarmChannel },
    { label: "Battery optimisation off for Ashborn", done: permissions.battery, fix: fixPermission.battery },
    ...(permissions.xiaomi ? [{ label: "Autostart on (Xiaomi)", done: null, fix: fixPermission.autostart }] : []),
    { label: "Alarms refresh while the app is closed", done: background, fix: () => setAsking(true) },
  ];

  return (
    <div className="space-y-1">
      {items.map((item) => (
        <button key={item.label} type="button" onClick={item.fix} disabled={item.done === true} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-[13px]">
          <span className={item.done ? "text-emerald-300" : item.done === false ? "text-amber-300" : "text-muted"}>{item.done ? "✓" : item.done === false ? "!" : "?"}</span>
          <span className={item.done ? "text-muted" : "text-ink/85"}>{item.label}</span>
          {item.done ? null : <span className="ml-auto text-[12px] text-muted">Open →</span>}
        </button>
      ))}
      {asking && !background ? <BackgroundSignIn
          onConnected={() => {
            connectedAt.current = Date.now();
            setConnected(true);
          }}
        /> : null}
    </div>
  );
}

// The background refresh signs in separately (alarms.ts connectBackgroundRefresh), with the signed-in
// user's email and the password typed here
function BackgroundSignIn({ onConnected }: { onConnected: () => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // While connecting, so a second tap doesn't make a second session
  const [connecting, setConnecting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setConnecting(true);
    setMessage(null);
    const { data } = await db.auth.getSession();
    const email = data.session?.user.email;
    const error = email ? await connectBackgroundRefresh(email, password) : "Not signed in.";
    setConnecting(false);
    if (error) setMessage(error);
    else onConnected();
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-2 px-1 pt-1">
      <input type="password" required autoFocus placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-ink/10 bg-canvas/70 px-3 py-2 text-xs text-ink/90 placeholder:text-muted focus:border-ink/30 focus:outline-none" />
      <button type="submit" disabled={connecting} className="min-h-11 rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50">
        Connect
      </button>
      {message ? <p className="w-full text-[12px] text-ink/60">{message}</p> : null}
    </form>
  );
}

// The phone's stored schedule and when the app and the background refresh each last handed it over,
// with a button to sync now
function Held({ sync }: { sync: () => Promise<void> }) {
  const held = useHeldSchedule();
  const [syncing, setSyncing] = useState(false);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await sync();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-2 px-1 text-[13px]">
      <button type="button" onClick={() => void syncNow()} disabled={syncing} className="min-h-11 rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50">
        {syncing ? "Syncing…" : "Sync now"}
      </button>
      {held ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            <dt className="text-muted">From the app</dt>
            <dd className="font-mono tabular-nums text-ink/85">{held.appHandedAt ? moment(held.appHandedAt) : "never"}</dd>
            <dt className="text-muted">From the background</dt>
            <dd className="font-mono tabular-nums text-ink/85">{held.backgroundHandedAt ? moment(held.backgroundHandedAt) : "never"}</dd>
            <dt className="text-muted">Android rings next</dt>
            <dd className="font-mono tabular-nums text-ink/85">{held.system ? `${moment(held.system.at)}${held.system.ours ? "" : " (another app)"}` : "nothing set"}</dd>
          </dl>
          {held.alarms.length === 0 ? (
            <p className="text-ink/85">No alarms to ring.</p>
          ) : (
            <ul aria-label="Next alarms on this phone" className="space-y-1">
              {held.alarms.map((alarm) => (
                <li key={alarm.key} className="flex gap-3 text-ink/85">
                  <span className="font-mono tabular-nums text-muted">{moment(alarm.at)}</span>
                  <span className="min-w-0 truncate">{alarm.title}</span>
                </li>
              ))}
            </ul>
          )}
          <BackgroundLog log={held.log} />
        </>
      ) : null}
    </div>
  );
}

// What the background did: counts that say whether wakes reach the network in Doze and whether FCM
// lowers pushes' priority, then each wake and push, newest first
function BackgroundLog({ log }: { log: BackgroundEntry[] }) {
  const wakes = log.filter((entry) => entry.type === "wake");
  const pushes = log.filter((entry) => entry.type === "push");
  const lowered = pushes.filter((push) => push.originalPriority === "high" && push.priority !== "high").length;
  const delays = pushes.filter((push) => push.sentAt > 0).map((push) => push.at - push.sentAt);
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer text-muted">Background log</summary>
      <p className="mt-1 text-ink/85">
        Wakes: {wakes.length}, refreshed {wakes.filter((wake) => wake.outcome === "refreshed").length}, in Doze {wakes.filter((wake) => wake.idle).length}.
        {" "}Pushes: {pushes.length}, high asked {pushes.filter((push) => push.originalPriority === "high").length}, lowered by FCM {lowered}
        {delays.length > 0 ? `, longest delay ${seconds(Math.max(...delays))}` : ""}.
      </p>
      <ul aria-label="Background log" className="mt-1 space-y-0.5">
        {[...log].reverse().map((entry, index) => (
          <li key={index} className="flex gap-3 text-ink/85">
            <span className="font-mono tabular-nums text-muted">{moment(entry.at)}</span>
            <span className="min-w-0">
              {entry.type === "wake"
                ? `wake${entry.idle ? ", Doze" : ""}${entry.exempt ? "" : ", not exempt"}: ${entry.outcome}`
                : `push ${entry.kind}, ${entry.originalPriority === entry.priority ? entry.priority : `${entry.originalPriority} lowered to ${entry.priority}`}${entry.sentAt > 0 ? `, after ${seconds(entry.at - entry.sentAt)}` : ""}: ${entry.outcome}`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const seconds = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`);

// A moment as its weekday and clock time
const moment = (at: number) => new Date(at).toLocaleString([], { timeZone: currentTimeZone(), weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: "h12" });
