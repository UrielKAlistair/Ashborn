import { Capacitor, registerPlugin } from "@capacitor/core";
import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { publishableKey, url } from "./client";
import { RING_LOOKBACK_MS, upcomingAlarms } from "../shared/schedule";
import type { AlarmKind, Snapshot } from "../shared/types";

// How far ahead the phone's alarm clock is filled; the app refills it each time it runs
const SCHEDULE_DAYS = 7;
// How often the open app checks whether an alarm has started ringing
const RINGING_POLL_MS = 2000;

export type AlarmPermissions = { notifications: boolean; fullScreen: boolean; battery: boolean; xiaomi: boolean; background: boolean };

export type RingingAlarm = { key: string; at: number; title: string; kind: Exclude<AlarmKind, "none"> };

// The native side, in android/app/src/main/java/dev/ashborn/app/AlarmPlugin.java
type AlarmPlugin = {
  schedule(options: { alarms: RingingAlarm[] }): Promise<void>;
  ringing(): Promise<{ alarm: RingingAlarm | null }>;
  // `kind`: the stop of the ring shown; refused (stopped false) when a harder ring has joined it since
  stop(options: { kind: RingingAlarm["kind"] }): Promise<{ stopped: boolean }>;
  snooze(options: { kind: RingingAlarm["kind"] }): Promise<{ stopped: boolean }>;
  permissions(): Promise<AlarmPermissions>;
  requestNotifications(): Promise<void>;
  openFullScreenSettings(): Promise<void>;
  requestBatteryExemption(): Promise<void>;
  openAutostart(): Promise<void>;
  connectBackground(options: { url: string; publishableKey: string; refreshToken: string }): Promise<void>;
};

// Alarms exist only in the Android app
export const alarmsAvailable = Capacitor.isNativePlatform();
const plugin = registerPlugin<AlarmPlugin>("AshbornAlarm");

// Keeps the phone's alarm clock in step with the routines and deadlines on screen
export function useAlarmSchedule(snapshot: Snapshot | null) {
  const alarms = snapshot
    ? upcomingAlarms(snapshot, new Date(Date.now() - RING_LOOKBACK_MS), SCHEDULE_DAYS + 1).map((alarm) => ({ key: alarm.key, at: alarm.at.getTime(), title: alarm.title, kind: alarm.kind }))
    : null;
  const signature = JSON.stringify(alarms);

  useEffect(() => {
    if (alarmsAvailable && alarms) void plugin.schedule({ alarms });
  }, [signature]);
}

// Reads the alarm ringing now
const readRinging = (setAlarm: (alarm: RingingAlarm | null) => void) => void plugin.ringing().then((result) => setAlarm(result.alarm));

// The alarm ringing now, if any, and ways to stop or snooze it. A stop the phone refuses (a harder
// ring joined after this one was shown) leaves the screen up and reads the ring again.
export function useRingingAlarm() {
  const [alarm, setAlarm] = useState<RingingAlarm | null>(null);
  const shown = useRef(alarm);
  shown.current = alarm;

  useEffect(() => {
    if (!alarmsAvailable) return;
    const check = () => readRinging(setAlarm);
    check();
    const interval = window.setInterval(() => document.visibilityState === "visible" && check(), RINGING_POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const end = useCallback((ask: typeof plugin.stop) => {
    if (!shown.current) return;
    void ask({ kind: shown.current.kind }).then(({ stopped }) => (stopped ? setAlarm(null) : readRinging(setAlarm)));
  }, []);
  const stop = useCallback(() => end((options) => plugin.stop(options)), [end]);
  // The native side rings a plain alarm again ten minutes on
  const snooze = useCallback(() => end((options) => plugin.snooze(options)), [end]);

  return [alarm, stop, snooze] as const;
}

// What alarms need from the phone, re-checked whenever the app comes back to the front (the
// user may have just changed a setting); null off the phone
export function useAlarmPermissions() {
  const [permissions, setPermissions] = useState<AlarmPermissions | null>(null);

  useEffect(() => {
    if (!alarmsAvailable) return;
    const check = () => void plugin.permissions().then(setPermissions);
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  return permissions;
}

// The settings screens that grant each of them
export const fixPermission = {
  notifications: () => void plugin.requestNotifications(),
  fullScreen: () => void plugin.openFullScreenSettings(),
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
