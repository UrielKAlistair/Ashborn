import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { alarmsAvailable, connectBackgroundRefresh, fixPermission, type AlarmPermissions } from "../lib/alarms";
import { db } from "../lib/client";
import { SITUPS_TO_STOP, STEPS_TO_STOP } from "../lib/motion";
import { toISODate, week } from "../shared/dates";
import { nextOccurrence, upcomingAlarms, type AlarmInstance } from "../shared/schedule";
import type { Alarm, Snapshot, Weekday } from "../shared/types";
import type { Act } from "./home/HomePage";

// One-tap alarms, in minutes from now
const QUICK_MINUTES = [10, 30, 60, 120];

const kindLabels: Record<Alarm["kind"], string> = {
  plain: "Plain",
  walk: `Walk ${STEPS_TO_STOP} steps`,
  situps: `${SITUPS_TO_STOP} sit-ups`,
};

// Where a ring comes from, by its key's prefix
const sourceLabels: Record<string, string> = { alarm: "Alarm", routine: "Routine", deadline: "Deadline", meal: "Meal" };

// Today: everything still to ring today, each with a switch that skips it for today only. All
// alarms: the user's own alarms, each with a switch that turns it off; a tap opens it to edit or
// delete. A new alarm is set in a pop-up.
export function AlarmsPage({ snapshot, act, permissions }: { snapshot: Snapshot; act: Act; permissions: AlarmPermissions | null }) {
  const [view, setView] = useState<"today" | "all">("today");
  const [editing, setEditing] = useState<Alarm | "new" | null>(null);

  const save = (alarm: Omit<Alarm, "id" | "enabled">) => {
    if (editing === "new") void act("createAlarm", { ...alarm, id: crypto.randomUUID(), enabled: true });
    else if (editing) void act("updateAlarm", editing.id, alarm);
    setEditing(null);
  };

  return (
    <div className="panel-scroll flex min-h-0 min-w-0 flex-1 justify-center max-sm:overflow-y-auto">
      <section className="panel-lift rounded-2xl border border-ink/8 bg-panel panel-scroll flex min-h-0 w-full max-w-xl flex-col gap-5 overflow-y-auto p-5 max-sm:max-w-none max-sm:shrink-0 max-sm:overflow-visible">
        <div className="flex items-center justify-between gap-3">
          {view === "today" ? (
            <h1 className="caps font-display text-[13px] font-bold text-ink/90">Today</h1>
          ) : (
            <button type="button" onClick={() => setView("today")} className="caps font-display text-[13px] font-bold text-ink/90 hover:text-ink max-sm:min-h-11">
              ‹ All alarms
            </button>
          )}
          <div className="flex items-center gap-2">
            {view === "today" ? (
              <button type="button" onClick={() => setView("all")} className="rounded-lg px-2.5 py-1 text-[12.5px] text-muted hover:bg-ink/6 hover:text-ink/85 max-sm:min-h-11">
                All alarms
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditing("new")}
              aria-label="New alarm"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-ember text-lg leading-none text-canvas hover:brightness-110 max-sm:h-11 max-sm:w-11"
            >
              +
            </button>
          </div>
        </div>

        {alarmsAvailable ? null : <p className="-mt-3 text-[11.5px] text-muted">They ring on your phone.</p>}
        {permissions && view === "today" ? <Reliability permissions={permissions} /> : null}

        {view === "today" ? <TodayRings snapshot={snapshot} act={act} /> : <AllAlarms alarms={snapshot.alarms} act={act} onEdit={setEditing} />}
      </section>

      {editing ? (
        <Popup label={editing === "new" ? "New alarm" : "Edit alarm"} onClose={() => setEditing(null)}>
          {editing === "new" ? (
            <div className="flex flex-wrap gap-2">
              {QUICK_MINUTES.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => save({ label: "", kind: "plain", at: new Date(Date.now() + minutes * 60_000).toISOString(), time: null, weekdays: [] })}
                  className="rounded-lg border border-ink/12 px-3.5 py-1.5 text-[13px] text-ink/80 hover:bg-ink/6 active:bg-ink/10 max-sm:min-h-11"
                >
                  In {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
                </button>
              ))}
            </div>
          ) : null}
          <AlarmForm alarm={editing === "new" ? null : editing} onSave={save} />
          {editing === "new" ? null : (
            <button
              type="button"
              onClick={() => {
                void act("deleteAlarm", editing.id);
                setEditing(null);
              }}
              className="text-[12.5px] text-muted hover:text-red-300 max-sm:min-h-11"
            >
              Delete this alarm
            </button>
          )}
        </Popup>
      ) : null}
    </div>
  );
}

// What rings for the rest of today, skipped rings included (switched off), soonest first
function TodayRings({ snapshot, act }: { snapshot: Snapshot; act: Act }) {
  const now = new Date();
  const rings = upcomingAlarms({ ...snapshot, skippedAlarms: [] }, now, 1);
  const skipped = new Set(snapshot.skippedAlarms.map((skip) => skip.key));

  if (rings.length === 0) return <p className="rounded-xl bg-ink/[0.02] px-3 py-2.5 text-[12px] text-muted">Nothing rings for the rest of today.</p>;
  return (
    <div className="space-y-2">
      {rings.map((ring) => {
        const on = !skipped.has(ring.key);
        return (
          <Row key={ring.key} time={clock(ring.at)} title={ring.title} detail={detailOf(ring, snapshot)} dim={!on}>
            <Switch label={`${ring.title} rings today`} on={on} onChange={(rings) => void act("setAlarmSkip", ring.key, toISODate(ring.at), !rings)} />
          </Row>
        );
      })}
    </div>
  );
}

// The user's own alarms: the switch turns a whole alarm off, every day it repeats on
function AllAlarms({ alarms, act, onEdit }: { alarms: Alarm[]; act: Act; onEdit: (alarm: Alarm) => void }) {
  if (alarms.length === 0) return <p className="rounded-xl bg-ink/[0.02] px-3 py-2.5 text-[12px] text-muted">None set. Routines, deadlines and meals ring from their own settings.</p>;
  return (
    <div className="space-y-2">
      {[...alarms].sort(bySchedule).map((alarm) => (
        <Row
          key={alarm.id}
          time={alarm.time ?? clock(new Date(alarm.at!))}
          title={alarm.label || "Alarm"}
          detail={`${alarm.at ? `once, ${day(new Date(alarm.at))}` : daysText(alarm.weekdays)}${alarm.kind === "plain" ? "" : ` · ${kindLabels[alarm.kind].toLowerCase()}`}`}
          dim={!alarm.enabled}
          onOpen={() => onEdit(alarm)}
        >
          <Switch label={`${alarm.label || "Alarm"} on`} on={alarm.enabled} onChange={(enabled) => void act("updateAlarm", alarm.id, { enabled })} />
        </Row>
      ))}
    </div>
  );
}

// A ring or an alarm: its time and what it is, then its switch. With `onOpen`, the time and text
// are a button that opens it.
function Row({ time, title, detail, dim, onOpen, children }: { time: string; title: string; detail: string; dim: boolean; onOpen?: () => void; children: ReactNode }) {
  const content = (
    <>
      <span className="font-mono text-2xl tabular-nums text-ink/90">{time}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-ink/85 [overflow-wrap:anywhere]">{title}</span>
        <span className="mt-0.5 block text-[11.5px] text-muted">{detail}</span>
      </span>
    </>
  );
  return (
    <div role="group" aria-label={title} className={`flex items-center gap-4 rounded-xl bg-ink/[0.03] px-4 py-3 hover:bg-ink/[0.05] ${dim ? "opacity-50" : ""}`}>
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={`Edit ${title}`} className="flex min-w-0 flex-1 items-center gap-4 text-left">
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-4">{content}</div>
      )}
      {children}
    </div>
  );
}

// A ring's source, and for the user's own alarms how it stops
function detailOf(ring: AlarmInstance, snapshot: Snapshot) {
  const [source, rest] = ring.key.split(":");
  const alarm = source === "alarm" ? snapshot.alarms.find((candidate) => candidate.id === rest.split("@")[0]) : undefined;
  const stops = alarm && alarm.kind !== "plain" ? ` · ${kindLabels[alarm.kind].toLowerCase()}` : "";
  return `${sourceLabels[source] ?? "Alarm"}${stops}`;
}

// Over the page, closed by Escape or a click outside it
function Popup({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-2xl border border-ink/10 bg-card p-5 shadow-[var(--card-shadow)]">
        <div className="flex items-center justify-between">
          <p className="caps font-display text-[13px] font-bold text-ink/90">{label}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-muted hover:bg-ink/8 max-sm:h-11 max-sm:w-11">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
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
    <div className="space-y-1 rounded-xl bg-ink/[0.03] p-3">
      <p className="caps px-1 pb-1 font-display text-[11px] font-semibold text-ink/65">Alarm reliability</p>
      {items.map((item) => (
        <button key={item.label} type="button" onClick={item.fix} disabled={item.done === true} className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-[13px] max-sm:min-h-11">
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
      <button type="submit" className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50 max-sm:min-h-11">
        Connect
      </button>
      {message ? <p className="w-full text-[12px] text-ink/60">{message}</p> : null}
    </form>
  );
}

// A time, days (none: once, at the next such time), a label and how it stops; filled from `alarm`
// when editing one
function AlarmForm({ alarm, onSave }: { alarm: Alarm | null; onSave: (alarm: Omit<Alarm, "id" | "enabled">) => unknown }) {
  const [time, setTime] = useState(alarm ? (alarm.time ?? clock(new Date(alarm.at!))) : "07:00");
  const [days, setDays] = useState<Weekday[]>(alarm?.weekdays ?? []);
  const [label, setLabel] = useState(alarm?.label ?? "");
  const [kind, setKind] = useState<Alarm["kind"]>(alarm?.kind ?? "plain");

  const submit = () => {
    if (!time) return;
    const at = days.length === 0 ? nextOccurrence(time).toISOString() : null;
    onSave({ label: label.trim(), kind, at, time: at ? null : time, weekdays: days });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input type="time" aria-label="Time" value={time} onChange={(event) => setTime(event.target.value)} className={`${field} w-28 font-mono text-base tabular-nums`} />
        <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label (optional)" className={`${field} min-w-0 flex-1`} />
      </div>
      <div className="flex gap-1">
        {week.map((weekday) => (
          <button
            key={weekday}
            type="button"
            aria-pressed={days.includes(weekday)}
            onClick={() => setDays((current) => (current.includes(weekday) ? current.filter((d) => d !== weekday) : [...current, weekday]))}
            className={`flex-1 rounded-md border py-1.5 text-[11.5px] max-sm:min-h-11 ${days.includes(weekday) ? "border-ember/50 bg-ember/15 text-ember" : "border-ink/10 text-muted hover:bg-ink/6"}`}
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
        <button type="button" onClick={submit} className="rounded-lg bg-ember px-3 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 disabled:opacity-50 max-sm:min-h-11">
          {alarm ? "Save" : days.length === 0 ? "Set once" : "Set"}
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
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${on ? "border-transparent bg-ember" : "border-ink/15 bg-ink/[0.04]"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] ${on ? "left-[22px] bg-canvas" : "left-0.5 bg-ink/70"}`} />
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
  "rounded-lg border border-ink/10 bg-canvas/60 px-3 py-1.5 text-[13px] text-ink/90 placeholder:text-ink/35 focus:border-ember/60 focus:outline-none";
