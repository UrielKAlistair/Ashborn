import { useState } from "react";
import { alarmsAvailable, fixPermission, type AlarmPermissions } from "../lib/alarms";
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
    <section className="panel-scroll mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto rounded-3xl border border-white/10 bg-night-panel p-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[11px] uppercase tracking-[0.26em] text-white/55">Alarms</h1>
        {alarmsAvailable ? null : <p className="text-[11px] tracking-[0.1em] text-white/40">They ring on your phone.</p>}
      </div>

      {permissions ? <Reliability permissions={permissions} /> : null}

      <div className="flex flex-wrap gap-2">
        {QUICK_MINUTES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => void create({ label: "", kind: "plain", at: new Date(Date.now() + minutes * 60_000).toISOString(), time: null, weekdays: [] })}
            className="rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-xs tracking-[0.1em] text-white/80 hover:border-white/25 active:bg-white/10"
          >
            In {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
          </button>
        ))}
      </div>

      <NewAlarm onCreate={create} />

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-white/40">Your alarms</p>
        {mine.length === 0 ? <p className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-[11px] text-white/35">None set.</p> : null}
        <div className="space-y-2">
          {mine.map((alarm) => (
            <div key={alarm.id} className={`flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 ${alarm.enabled ? "" : "opacity-50"}`}>
              <p className="text-2xl font-light tabular-nums text-white/90">{alarm.time ?? clock(new Date(alarm.at!))}</p>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white/85">{alarm.label || "Alarm"}</p>
                <p className="mt-0.5 text-[11px] tracking-[0.08em] text-white/45">
                  {alarm.at ? `once, ${day(new Date(alarm.at))}` : daysText(alarm.weekdays)}
                  {alarm.kind === "plain" ? "" : ` · ${kindLabels[alarm.kind].toLowerCase()}`}
                </p>
              </div>
              <Switch label={`${alarm.label || "Alarm"} on`} on={alarm.enabled} onChange={(enabled) => void act("updateAlarm", alarm.id, { enabled })} />
              <button type="button" onClick={() => void act("deleteAlarm", alarm.id)} aria-label="Delete alarm" className="px-1 text-lg leading-none text-white/35 hover:text-red-300">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-white/40">From your schedule, next {SCHEDULE_DAYS} days</p>
        {fromSchedule.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 px-3 py-2 text-[11px] text-white/35">Routines and deadlines with an alarm time show here.</p>
        ) : null}
        <div className="space-y-1">
          {fromSchedule.map((alarm) => (
            <p key={alarm.key} className="flex gap-4 px-1 text-xs text-white/60">
              <span className="w-28 shrink-0 tabular-nums text-white/45">
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
// Xiaomi's Autostart cannot be read, so it is offered on Xiaomi phones without a tick.
function Reliability({ permissions }: { permissions: AlarmPermissions }) {
  const items = [
    { label: "Notifications allowed", done: permissions.notifications, fix: fixPermission.notifications },
    { label: "Alarms show over the lock screen", done: permissions.fullScreen, fix: fixPermission.fullScreen },
    { label: "Battery optimisation off for Ashborn", done: permissions.battery, fix: fixPermission.battery },
    ...(permissions.xiaomi ? [{ label: "Autostart on (Xiaomi)", done: null, fix: fixPermission.autostart }] : []),
  ];

  return (
    <div className="space-y-1 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <p className="px-1 pb-1 text-[10px] uppercase tracking-[0.22em] text-white/40">Alarm reliability</p>
      {items.map((item) => (
        <button key={item.label} type="button" onClick={item.fix} disabled={item.done === true} className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-xs">
          <span className={item.done ? "text-emerald-300" : item.done === false ? "text-amber-300" : "text-white/40"}>{item.done ? "✓" : item.done === false ? "!" : "?"}</span>
          <span className={item.done ? "text-white/50" : "text-white/85"}>{item.label}</span>
          {item.done ? null : <span className="ml-auto text-white/40">Open →</span>}
        </button>
      ))}
    </div>
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
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className={`${field} w-28 text-base [color-scheme:dark]`} />
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label (optional)" className={`${field} min-w-0 flex-1`} />
      </div>
      <div className="flex gap-1">
        {week.map((weekday) => (
          <button
            key={weekday}
            type="button"
            onClick={() => setDays((current) => (current.includes(weekday) ? current.filter((d) => d !== weekday) : [...current, weekday]))}
            className={`flex-1 rounded-md border py-1.5 text-[10px] uppercase ${days.includes(weekday) ? "border-sky-300/40 bg-sky-400/15 text-white/90" : "border-white/10 text-white/40"}`}
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
        <button type="button" onClick={submit} className="rounded-lg border border-sky-300/35 bg-sky-400/15 px-4 py-1.5 text-xs uppercase tracking-[0.16em] text-sky-100 hover:bg-sky-400/25">
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
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${on ? "border-sky-300/40 bg-sky-400/30" : "border-white/15 bg-white/[0.04]"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white/85 transition-[left] ${on ? "left-[22px]" : "left-0.5"}`} />
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
  "rounded-lg border border-white/10 bg-night/70 px-3 py-1.5 text-sm text-white/90 placeholder:text-white/35 focus:border-white/30 focus:outline-none";
