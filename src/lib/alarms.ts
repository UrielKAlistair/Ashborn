/**
 * The app's side of the phone's alarms: alarms ring on Android only, from a native plugin
 * (AlarmPlugin.java), so they ring with the app closed. This file wraps that plugin.
 *
 * - useAlarmSchedule hands the phone the next week's rings whenever they change; the phone stores
 *   them and arms Android's alarm clock (a background refresh keeps them current while the app is shut).
 * - useRingingAlarm shows a ring going off and stops or snoozes it.
 * - useAlarmPermissions and fixPermission report and open the settings rings depend on.
 * - useHeldSchedule reads back what the phone holds, for Settings.
 * - connectBackgroundRefresh gives that background refresh a session of its own.
 * - setTimeUpNotice and keepScreenAwake ask the phone for the end-of-timer notice and a screen kept on
 *   (let go when the module loads, in case a reloaded page held it).
 * Off the phone every hook returns null or does nothing.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { publishableKey, url } from "./client";
import { RING_LOOKBACK_MS, upcomingAlarms } from "../shared/schedule";
import type { AlarmKind, AlarmSound, Snapshot } from "../shared/types";

// How far ahead the phone's alarm clock is filled; the app refills it each time it runs
const SCHEDULE_DAYS = 7;
// How often the open app checks whether an alarm has started ringing
const RINGING_POLL_MS = 2000;
// How long a stopped ring the phone still reports is taken for its stop not yet handled
const STOP_SETTLE_MS = 5000;

// notifications: the app may notify (permission given, notifications not switched off);
// exactAlarms: alarms can be set at all (Android 12 lets the user take that away);
// fullScreen: a ring may open the ringing screen over the lock screen (a grant of its own from Android 14);
// alarmChannel: the Alarms notification channel is of high importance, so a ring pops up and shows over the lock screen;
// battery: exempt from battery optimisation, so the background refresh can reach the network in Doze;
// xiaomi: a Xiaomi phone, whose Autostart list must also allow the app;
// background: the background refresh has a session (connectBackgroundRefresh)
export type AlarmPermissions = { notifications: boolean; exactAlarms: boolean; fullScreen: boolean; alarmChannel: boolean; battery: boolean; xiaomi: boolean; background: boolean };

export type RingingAlarm = { key: string; at: number; title: string; kind: Exclude<AlarmKind, "none">; sound: AlarmSound };

// What the phone holds: the next alarms in its stored schedule, when (epoch ms) the app and the
// background refresh each last handed the schedule over, the next alarm clock Android itself
// will ring, from any app, and the background's log (Diagnostics.java), oldest first
export type HeldSchedule = {
  alarms: RingingAlarm[];
  appHandedAt: number | null;
  backgroundHandedAt: number | null;
  system: { at: number; ours: boolean } | null;
  log: BackgroundEntry[];
};

// A refresh wake: whether the phone was in Doze and exempt from battery optimisation. A push: its
// kind, when the server sent it (0 if unknown), and the priority asked for and delivered. Times in epoch ms.
export type BackgroundEntry =
  | { type: "wake"; at: number; idle: boolean; exempt: boolean; outcome: string }
  | { type: "push"; at: number; kind: string; sentAt: number; originalPriority: string; priority: string; outcome: string };

// The native side, in android/app/src/main/java/dev/ashborn/app/AlarmPlugin.java
type AlarmPlugin = {
  schedule(options: { alarms: RingingAlarm[] }): Promise<void>;
  ringing(): Promise<{ alarm: RingingAlarm | null }>;
  held(): Promise<HeldSchedule>;
  // `key` and `kind`: the ring shown; refused (stopped false) when another ring is going, or a harder one has joined it since
  stop(options: { key: string; kind: RingingAlarm["kind"] }): Promise<{ stopped: boolean }>;
  snooze(options: { key: string; kind: RingingAlarm["kind"] }): Promise<{ stopped: boolean }>;
  permissions(): Promise<AlarmPermissions>;
  requestNotifications(): Promise<void>;
  openFullScreenSettings(): Promise<void>;
  openAlarmChannelSettings(): Promise<void>;
  openExactAlarmSettings(): Promise<void>;
  requestBatteryExemption(): Promise<void>;
  openAutostart(): Promise<void>;
  connectBackground(options: { url: string; publishableKey: string; refreshToken: string }): Promise<void>;
  // `at` (epoch ms) the end of Now's timer on the step `title`, 0 when none runs; replaces the last
  timeUp(options: { at: number; title: string }): Promise<void>;
  keepAwake(options: { on: boolean }): Promise<void>;
};

// Alarms exist only in the Android app
export const alarmsAvailable = Capacitor.isNativePlatform();
const plugin = registerPlugin<AlarmPlugin>("AshbornAlarm");

// Has the phone say "Time's up" at `at` (epoch ms) about `title`, as a notification; 0 clears it.
// Phone only: the caller checks alarmsAvailable.
export const setTimeUpNotice = (at: number, title: string) => void plugin.timeUp({ at, title });

// Keeps the phone's screen on, or lets it sleep again; nothing off the phone
export const keepScreenAwake = (on: boolean) => {
  if (alarmsAvailable) void plugin.keepAwake({ on });
};
// A page that reloaded with a recipe open never let go: it starts let go
keepScreenAwake(false);

// Told each time the app has handed the phone its schedule
const handedOver = new Set<() => void>();
const handOver = (alarms: RingingAlarm[]) => void plugin.schedule({ alarms }).then(() => handedOver.forEach((listener) => listener()));

// Keeps the phone's alarm clock in step with the routines and deadlines on screen: on each change,
// and again whenever the app comes back to the screen, since the background refresh may have
// replaced the schedule meanwhile with what the server held (without changes still queued here).
// A change of `syncs` hands it over again.
export function useAlarmSchedule(snapshot: Snapshot | null, syncs: number) {
  const alarms = snapshot
    ? upcomingAlarms(snapshot, new Date(Date.now() - RING_LOOKBACK_MS), SCHEDULE_DAYS + 1).map((alarm) => ({ key: alarm.key, at: alarm.at.getTime(), title: alarm.title, kind: alarm.kind, sound: alarm.sound }))
    : null;
  const signature = JSON.stringify(alarms);
  const latest = useRef(alarms);
  latest.current = alarms;

  useEffect(() => {
    if (alarmsAvailable && alarms) handOver(alarms);
  }, [signature, syncs]);

  useEffect(() => {
    if (!alarmsAvailable) return;
    const resend = () => {
      if (document.visibilityState === "visible" && latest.current) handOver(latest.current);
    };
    document.addEventListener("visibilitychange", resend);
    return () => document.removeEventListener("visibilitychange", resend);
  }, []);
}

// The alarm ringing now, if any, and ways to stop or snooze it. A stop the phone refuses (another ring
// took its place, or a harder one joined, after this one was shown) leaves the screen up and reads
// the ring again.
export function useRingingAlarm() {
  const [alarm, setAlarm] = useState<RingingAlarm | null>(null);
  const shown = useRef(alarm);
  shown.current = alarm;
  // Counts stops and snoozes asked for: a read begun before one is answered after it, with the ring
  // as it was, and is dropped
  const asks = useRef(0);
  // The ring just stopped: the phone reports it until its service has handled the stop, a moment later
  const ended = useRef<{ ring: string; until: number } | null>(null);
  const read = useCallback(() => {
    const askedAt = asks.current;
    void plugin.ringing().then(({ alarm }) => {
      if (askedAt !== asks.current) return;
      if (alarm && ended.current && `${alarm.key}:${alarm.kind}` === ended.current.ring && Date.now() < ended.current.until) return;
      setAlarm(alarm);
    });
  }, []);

  useEffect(() => {
    if (!alarmsAvailable) return;
    read();
    const interval = window.setInterval(() => document.visibilityState === "visible" && read(), RINGING_POLL_MS);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", read);
    };
  }, [read]);

  const end = useCallback((ask: typeof plugin.stop) => {
    if (!shown.current) return;
    asks.current += 1;
    const ring = `${shown.current.key}:${shown.current.kind}`;
    void ask({ key: shown.current.key, kind: shown.current.kind }).then(
      ({ stopped }) => {
        if (!stopped) return read();
        ended.current = { ring, until: Date.now() + STOP_SETTLE_MS };
        setAlarm(null);
      },
      () => read(),
    );
  }, [read]);
  const stop = useCallback(() => end((options) => plugin.stop(options)), [end]);
  // The native side rings a plain alarm again ten minutes on
  const snooze = useCallback(() => end((options) => plugin.snooze(options)), [end]);

  return [alarm, stop, snooze] as const;
}

// What alarms need from the phone, re-checked whenever the app comes back to the front (the
// user may have just changed a setting) or the window gets focus back (Android's permission
// dialogs only pause the app, so it never goes hidden); null off the phone
export function useAlarmPermissions() {
  const [permissions, setPermissions] = useState<AlarmPermissions | null>(null);

  useEffect(() => {
    if (!alarmsAvailable) return;
    const check = () => void plugin.permissions().then(setPermissions);
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  return permissions;
}

// What the phone holds, read again after each handover from the app and whenever the app comes back
// to the front (the background refresh may have handed one over meanwhile); null off the phone
export function useHeldSchedule() {
  const [held, setHeld] = useState<HeldSchedule | null>(null);

  useEffect(() => {
    if (!alarmsAvailable) return;
    const read = () => void plugin.held().then(setHeld);
    read();
    handedOver.add(read);
    document.addEventListener("visibilitychange", read);
    return () => {
      handedOver.delete(read);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);

  return held;
}

// The settings screens that grant each of them
export const fixPermission = {
  notifications: () => void plugin.requestNotifications(),
  fullScreen: () => void plugin.openFullScreenSettings(),
  alarmChannel: () => void plugin.openAlarmChannelSettings(),
  exactAlarms: () => void plugin.openExactAlarmSettings(),
  battery: () => void plugin.requestBatteryExemption(),
  autostart: () => void plugin.openAutostart(),
};

// Gives the phone's background alarm refresh (AlarmRefreshWorker.java) a session of its own, by
// signing in a second time: Supabase refresh tokens are single-use, so it cannot share the app's.
// Returns the sign-in error's message, or null.
export async function connectBackgroundRefresh(email: string, password: string) {
  const second = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, storageKey: "ashborn-alarm-refresh" } });
  const { data, error } = await second.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  try {
    await plugin.connectBackground({ url, publishableKey, refreshToken: data.session.refresh_token });
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
  return null;
}
