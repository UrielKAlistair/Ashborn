/**
 * What Now remembers on this device, and the "Time's up" notice of a started step.
 *
 * Kept between sittings (localStorage): the steps put off today, and the timer on a started step.
 * Kept for this sitting only (module state): the step last split, and the one Split is open on.
 * Where storage refuses (a private window), the first two are forgotten too. Every change raises one
 * window event, so every reader follows it, wherever it was made (Now, the timer's end, another screen).
 * Which step Now then shows is decided from this memory by chooseNow (shared/nowStep.ts).
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { alarmsAvailable, setTimeUpNotice } from "../../lib/alarms";
import type { NowMemory, StartTimer } from "../../shared/nowStep";
import type { ISODate } from "../../shared/types";
import { readStored as read, writeStored as write } from "../../lib/storage";

const passedKey = "ashborn-now-passed";
const timerKey = "ashborn-now-timer";
const changeEvent = "ashborn:now-memory";
// A started step's time box, and the extra time offered when it ends
export const START_MINUTES = 15;
export const MORE_MINUTES = 5;

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

// Set from Now; cleared too when its step is done, deleted or shelved (App.tsx)
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
// `titleOf` names the step, or gives nothing once it is done or gone, and then nothing is said. On
// the phone, where the page can't notify and stops when put away, the phone says it (TimeUp.java),
// set again whenever the timer or its step's title changes, and when the app comes back to the screen
// (which takes down a notice already shown). `known`: the data is in, so `titleOf` can name a step;
// until then nothing is set or cleared.
export function useTimeUpNotice(titleOf: (stepId: string) => string | undefined, known: boolean) {
  const latestTitleOf = useRef(titleOf);
  latestTitleOf.current = titleOf;
  useSyncExternalStore(onNowMemoryChange, () => version);
  const timer = alarmsAvailable ? storedTimer() : null;
  const title = timer ? titleOf(timer.stepId) : undefined;
  const noticeAt = timer && title !== undefined ? timer.endsAt : 0;
  useEffect(() => {
    if (!alarmsAvailable || !known) return;
    const set = () => setTimeUpNotice(noticeAt, title ?? "");
    set();
    const onShow = () => document.visibilityState === "visible" && set();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [noticeAt, title, known]);
  useEffect(() => {
    if (alarmsAvailable) return;
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
