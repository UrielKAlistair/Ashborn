import { Capacitor, registerPlugin } from "@capacitor/core";
import { useCallback, useEffect, useState } from "react";
import { upcomingAlarms } from "../shared/schedule";
import type { AlarmKind, Snapshot } from "../shared/types";

// How far ahead the phone's alarm clock is filled; the app refills it each time it runs
const SCHEDULE_DAYS = 7;
// How often the open app checks whether an alarm has started ringing
const RINGING_POLL_MS = 2000;

export type AlarmPermissions = { notifications: boolean; fullScreen: boolean; battery: boolean; xiaomi: boolean };

export type RingingAlarm = { key: string; at: number; title: string; kind: Exclude<AlarmKind, "none"> };

// The native side, in android/app/src/main/java/dev/ashborn/app/AlarmPlugin.java
type AlarmPlugin = {
  schedule(options: { alarms: RingingAlarm[] }): Promise<void>;
  ringing(): Promise<{ alarm: RingingAlarm | null }>;
  stop(): Promise<void>;
  permissions(): Promise<AlarmPermissions>;
  requestNotifications(): Promise<void>;
  openFullScreenSettings(): Promise<void>;
  requestBatteryExemption(): Promise<void>;
  openAutostart(): Promise<void>;
};

// Alarms exist only in the Android app
export const alarmsAvailable = Capacitor.isNativePlatform();
const plugin = registerPlugin<AlarmPlugin>("AshbornAlarm");

// Keeps the phone's alarm clock in step with the routines and deadlines on screen
export function useAlarmSchedule(snapshot: Snapshot | null) {
  const alarms = snapshot
    ? upcomingAlarms(snapshot, new Date(), SCHEDULE_DAYS).map((alarm) => ({ key: alarm.key, at: alarm.at.getTime(), title: alarm.title, kind: alarm.kind }))
    : null;
  const signature = JSON.stringify(alarms);

  useEffect(() => {
    if (alarmsAvailable && alarms) void plugin.schedule({ alarms });
  }, [signature]);
}

// The alarm ringing now, if any, and a way to stop it
export function useRingingAlarm() {
  const [alarm, setAlarm] = useState<RingingAlarm | null>(null);

  useEffect(() => {
    if (!alarmsAvailable) return;
    const check = () => void plugin.ringing().then((result) => setAlarm(result.alarm));
    check();
    const interval = window.setInterval(() => document.visibilityState === "visible" && check(), RINGING_POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const stop = useCallback(() => {
    void plugin.stop();
    setAlarm(null);
  }, []);

  return [alarm, stop] as const;
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
