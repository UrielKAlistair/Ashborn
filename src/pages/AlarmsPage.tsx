import { useState, type FormEvent } from "react";
import { alarmsAvailable, connectBackgroundRefresh, fixPermission, type AlarmPermissions } from "../lib/alarms";
import { db } from "../lib/client";
import { SITUPS_TO_STOP, STEPS_TO_STOP } from "../lib/motion";
import { week } from "../shared/dates";
import { nextOccurrence, upcomingAlarms } from "../shared/schedule";
import type { Alarm, Snapshot, Weekday } from "../shared/types";
import type { Act } from "./home/HomePage";

// One-tap alarms, in minutes from now
const QUICK_MINUTES = [10, 30, 60, 120];
// How far ahead the schedule's own alarms (routines, deadlines) are listed
const SCHEDULE_DAYS = 7;

const kindLabels: Record<Alarm["kind"], string> = {
  plain: "Plain",
  walk: `Walk ${STEPS_TO_STOP} steps`,
  situps: `${SITUPS_TO_STOP} sit-ups`,
};

// Alarms of their own (quick ones, one-offs, recurring ones with a challenge), and the alarms
// the schedule sets from routines and deadlines. They ring on the phone.
export function AlarmsPage({ snapshot, act, permissions }: { snapshot: Snapshot; act: Act; permissions: AlarmPermissions | null }) {
  const mine = [...snapshot.alarms].sort(bySchedule);
  const fromSchedule = upcomingAlarms(snapshot, new Date(), SCHEDULE_DAYS).filter((alarm) => !alarm.key.startsWith("alarm:"));

  const create = (alarm: Omit<Alarm, "id" | "enabled">) => act("createAlarm", { ...alarm, id: crypto.randomUUID(), enabled: true });

  return (
    <section className="panel-lift rounded-2xl border border-white/8 bg-night-panel panel-scroll mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto p-5">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-base font-semibold text-white/90">Alarms</h1>
        {alarmsAvailable ? null : <p className="text-[11.5px] text-white/45">They ring on your phone.</p>}
      </div>

      {permissions ? <Reliability permissions={permissions} /> : null}

      <div className="flex flex-wrap gap-2">
        {QUICK_MINUTES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => void create({ label: "", kind: "plain", at: new Date(Date.now() + minutes * 60_000).toISOString(), time: null, weekdays: [] })}
            className="rounded-lg border border-white/12 px-3.5 py-1.5 text-[13px] text-white/80 hover:bg-white/6 active:bg-white/10 max-sm:min-h-11"
          >
            In {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
          </button>
        ))}
      </div>

      <NewAlarm onCreate={create} />

      <div>
        <p className="mb-2 font-display text-[13px] font-semibold text-white/80">Your alarms</p>
        {mine.length === 0 ? <p className="rounded-xl bg-white/[0.02] px-3 py-2.5 text-[12px] text-white/40">None set.</p> : null}
        <div className="space-y-2">
          {mine.map((alarm) => (
            <div key={alarm.id} className={`flex items-center gap-4 rounded-xl bg-white/[0.03] px-4 py-3 hover:bg-white/[0.05] ${alarm.enabled ? "" : "opacity-50"}`}>
              <p className="font-mono text-2xl tabular-nums text-white/90">{alarm.time ?? clock(new Date(alarm.at!))}</p>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-white/85">{alarm.label || "Alarm"}</p>
                <p className="mt-0.5 text-[11.5px] text-white/45">
                  {alarm.at ? `once, ${day(new Date(alarm.at))}` : daysText(alarm.weekdays)}
                  {alarm.kind === "plain" ? "" : ` · ${kindLabels[alarm.kind].toLowerCase()}`}
                </p>
              </div>
              <Switch label={`${alarm.label || "Alarm"} on`} on={alarm.enabled} onChange={(enabled) => void act("updateAlarm", alarm.id, { enabled })} />
              <button type="button" onClick={() => void act("deleteAlarm", alarm.id)} aria-label="Delete alarm" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-lg leading-none text-white/40 hover:bg-white/8 hover:text-red-300 max-sm:h-11 max-sm:w-11">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 font-display text-[13px] font-semibold text-white/80">From your schedule, next {SCHEDULE_DAYS} days</p>
        {fromSchedule.length === 0 ? (
          <p className="rounded-xl bg-white/[0.02] px-3 py-2.5 text-[12px] text-white/40">Routines and deadlines with an alarm time show here.</p>
        ) : null}
        <div className="space-y-1">
          {fromSchedule.map((alarm) => (
            <p key={alarm.key} className="flex gap-4 px-1 text-[13px] text-white/65">
              <span className="w-32 shrink-0 font-mono text-[11.5px] tabular-nums text-white/45">
                {day(alarm.at)} {clock(alarm.at)}
              </span>
              <span className="truncate">{alarm.title}</span>
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

// What the phone must allow for alarms to ring on time, each with a button to its setting.
// Xiaomi's Autostart cannot be read, so it is offered on Xiaomi phones without a tick. The
// background refresh needs a sign-in of its own, so it asks for the password.
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
    <div className="space-y-1 rounded-xl bg-white/[0.03] p-3">
      <p className="px-1 pb-1 font-display text-[13px] font-semibold text-white/80">Alarm reliability</p>
      {items.map((item) => (
        <button key={item.label} type="button" onClick={item.fix} disabled={item.done === true} className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-[13px] max-sm:min-h-11">
          <span className={item.done ? "text-emerald-300" : item.done === false ? "text-amber-300" : "text-white/40"}>{item.done ? "✓" : item.done === false ? "!" : "?"}</span>
          <span className={item.done ? "text-white/50" : "text-white/85"}>{item.label}</span>
          {item.done ? null : <span className="ml-auto text-[12px] text-white/45">Open →</span>}
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
      <input type="password" required autoFocus placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-night/70 px-3 py-2 text-xs text-white/90 placeholder:text-white/40 focus:border-white/30 focus:outline-none" />
      <button type="submit" className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-night hover:brightness-110 disabled:opacity-50 max-sm:min-h-11">
        Connect
      </button>
      {message ? <p className="w-full text-[12px] text-white/60">{message}</p> : null}
    </form>
  );
}

// A time, days (none: once, at the next such time), a label and how it stops
function NewAlarm({ onCreate }: { onCreate: (alarm: Omit<Alarm, "id" | "enabled">) => unknown }) {
  const [time, setTime] = useState("07:00");
  const [days, setDays] = useState<Weekday[]>([]);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Alarm["kind"]>("plain");

  const submit = () => {
    if (!time) return;
    const at = days.length === 0 ? nextOccurrence(time).toISOString() : null;
    onCreate({ label: label.trim(), kind, at, time: at ? null : time, weekdays: days });
    setLabel("");
    setDays([]);
  };

  return (
    <div className="space-y-3 rounded-xl bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={`${field} w-28 font-mono text-base tabular-nums`} />
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label (optional)" className={`${field} min-w-0 flex-1`} />
      </div>
      <div className="flex gap-1">
        {week.map((weekday) => (
          <button
            key={weekday}
            type="button"
            onClick={() => setDays((current) => (current.includes(weekday) ? current.filter((d) => d !== weekday) : [...current, weekday]))}
            className={`flex-1 rounded-md border py-1.5 text-[11.5px] max-sm:min-h-11 ${days.includes(weekday) ? "border-ember/50 bg-ember/15 text-ember" : "border-white/10 text-white/45 hover:bg-white/6"}`}
          >
            {weekday.slice(0, 2)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <select value={kind} onChange={(event) => setKind(event.target.value as Alarm["kind"])} className={`${field} flex-1`}>
          {(Object.keys(kindLabels) as Alarm["kind"][]).map((option) => (
            <option key={option} value={option}>
              {kindLabels[option]}
            </option>
          ))}
        </select>
        <button type="button" onClick={submit} className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-night hover:brightness-110 disabled:opacity-50 max-sm:min-h-11">
          Set {days.length === 0 ? "once" : ""}
        </button>
      </div>
    </div>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${on ? "border-transparent bg-ember" : "border-white/15 bg-white/[0.04]"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] ${on ? "left-[22px] bg-night" : "left-0.5 bg-white/70"}`} />
    </button>
  );
}

// Recurring alarms by time of day, then one-offs by when they ring
function bySchedule(a: Alarm, b: Alarm) {
  if (a.time && b.time) return a.time.localeCompare(b.time);
  if (a.at && b.at) return a.at.localeCompare(b.at);
  return a.time ? -1 : 1;
}

function daysText(days: Weekday[]) {
  if (days.length === 7) return "every day";
  return week.filter((weekday) => days.includes(weekday)).join(" ");
}

const clock = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const day = (date: Date) => date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });

const field =
  "rounded-lg border border-white/10 bg-night/60 px-3 py-1.5 text-[13px] text-white/90 placeholder:text-white/35 focus:border-ember/60 focus:outline-none";
