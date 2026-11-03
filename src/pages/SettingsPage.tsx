import { useState, type FormEvent, type ReactNode } from "react";
import { connectBackgroundRefresh, fixPermission, type AlarmPermissions } from "../lib/alarms";
import { db } from "../lib/client";
import { setTheme, themeNames, themes, useTheme } from "../lib/useTheme";

// The phone's settings: the theme, and what the phone must allow for alarms to ring on time
// (`permissions` is null outside the Android app)
export function SettingsPage({ permissions }: { permissions: AlarmPermissions | null }) {
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
              className={`min-h-11 flex-1 rounded-lg text-[13px] ${theme === option ? "bg-card text-ink shadow-[var(--card-shadow)]" : "text-muted"}`}
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
  const [connected, setConnected] = useState(false);
  const [asking, setAsking] = useState(false);
  const background = permissions.background || connected;
  const items = [
    { label: "Notifications allowed", done: permissions.notifications, fix: fixPermission.notifications },
    { label: "Alarms show over the lock screen", done: permissions.fullScreen, fix: fixPermission.fullScreen },
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
      {asking && !background ? <BackgroundSignIn onConnected={() => setConnected(true)} /> : null}
    </div>
  );
}

function BackgroundSignIn({ onConnected }: { onConnected: () => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { data } = await db.auth.getSession();
    const email = data.session?.user.email;
    const error = email ? await connectBackgroundRefresh(email, password) : "Not signed in.";
    if (error) setMessage(error);
    else onConnected();
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-wrap items-center gap-2 px-1 pt-1">
      <input type="password" required autoFocus placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-canvas/70 px-3 py-2 text-xs text-ink/90 placeholder:text-muted focus:border-ink/30 focus:outline-none" />
      <button type="submit" className="min-h-11 rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50">
        Connect
      </button>
      {message ? <p className="w-full text-[12px] text-ink/60">{message}</p> : null}
    </form>
  );
}
