import { useEffect, useRef, useSyncExternalStore } from "react";
import type { NowMemory, StartTimer } from "../../shared/nowStep";
import type { ISODate } from "../../shared/types";

// What Now remembers on this device: the steps put off today and the timer on a started step, kept
// between sittings; the step last split and the one Split is open on, for this sitting. On how many
// days each step was put off is kept too, for the nudge. Where storage refuses (a private window),
// it is forgotten. Every reader follows a change, wherever it was made: Now, the tray, another screen.

const passedKey = "ashborn-now-passed";
const passedOverKey = "ashborn-passed-over";
const timerKey = "ashborn-now-timer";
const changeEvent = "ashborn:now-memory";
// A started step's time box, and the extra time offered when it ends
export const START_MINUTES = 15;
export const MORE_MINUTES = 5;

export type PassedOver = Record<string, { days: number; last: string }>; // by step: days passed over, the latest

let splitFrom: string | null = null;
let holding: string | null = null;
let version = 0;

// What Now remembers today, read afresh whenever any of it changes
export function useNowMemory(date: ISODate): NowMemory {
  useSyncExternalStore(onNowMemoryChange, () => version);
  const passed = read<{ date: string; ids: string[] } | null>(passedKey, null);
  return { passed: passed?.date === date ? passed.ids : [], timer: storedTimer(), splitFrom, holding };
}

export function storePassed(date: ISODate, ids: string[]) {
  write(passedKey, { date, ids });
  changed();
}

export const storedTimer = () => read<StartTimer | null>(timerKey, null);

// Set from Now or from the tray's menu
export function storeTimer(timer: StartTimer | null) {
  write(timerKey, timer);
  changed();
}

export function timerBox(stepId: string, minutes: number): StartTimer {
  return { stepId, startedAt: Date.now(), endsAt: Date.now() + minutes * 60_000 };
}

export function setSplitFrom(id: string | null) {
  splitFrom = id;
  changed();
}

export function setHolding(id: string | null) {
  holding = id;
  changed();
}

export const passedOver = () => read<PassedOver>(passedOverKey, {});

export function storePassedOver(counts: PassedOver) {
  write(passedOverKey, counts);
  changed();
}

export function onNowMemoryChange(follow: () => void) {
  const handle = () => {
    version++;
    follow();
  };
  window.addEventListener(changeEvent, handle);
  return () => window.removeEventListener(changeEvent, handle);
}

function changed() {
  window.dispatchEvent(new Event(changeEvent));
}

// Says when a started step's time is up, whichever screen is open and even with the window hidden.
// `titleOf` names the step, or gives nothing once it is done or gone, and then nothing is said.
export function useTimeUpNotice(titleOf: (stepId: string) => string | undefined) {
  const latestTitleOf = useRef(titleOf);
  latestTitleOf.current = titleOf;
  useEffect(() => {
    let end = 0;
    const schedule = () => {
      window.clearTimeout(end);
      const timer = storedTimer();
      // A timer that ended while the app was closed has had its moment
      if (!timer || timer.endsAt <= Date.now()) return;
      end = window.setTimeout(() => {
        const title = latestTitleOf.current(timer.stepId);
        if (title && "Notification" in window && Notification.permission === "granted") new Notification(`Time's up: ${title}`, { body: "Done, or keep going?" });
      }, timer.endsAt - Date.now());
    };
    schedule();
    const stop = onNowMemoryChange(schedule);
    return () => {
      stop();
      window.clearTimeout(end);
    };
  }, []);
}

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(window.localStorage.getItem(key) ?? "null") as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Forgotten, as in a private window
  }
}
