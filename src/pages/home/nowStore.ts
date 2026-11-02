// What Now remembers on this device between sittings: on how many days each step was passed over, and the
// timer on a started step. Where storage refuses (a private window), it is forgotten.

const passedOverKey = "ashborn-passed-over";
const timerKey = "ashborn-now-timer";
const timerEvent = "ashborn:now-timer";
// A started step's time box, and the extra time offered when it ends
export const START_MINUTES = 15;
export const MORE_MINUTES = 5;

export type StartTimer = { stepId: string; startedAt: number; endsAt: number };
export type PassedOver = Record<string, { days: number; last: string }>; // by step: days passed over, the latest

export const passedOver = () => read<PassedOver>(passedOverKey, {});

export function storePassedOver(counts: PassedOver) {
  write(passedOverKey, counts);
}

export const storedTimer = () => read<StartTimer | null>(timerKey, null);

// Set from Now or from the tray's menu; Now follows either
export function storeTimer(timer: StartTimer | null) {
  write(timerKey, timer);
  window.dispatchEvent(new Event(timerEvent));
}

export function timerBox(stepId: string, minutes: number): StartTimer {
  return { stepId, startedAt: Date.now(), endsAt: Date.now() + minutes * 60_000 };
}

export function onTimerChange(follow: () => void) {
  window.addEventListener(timerEvent, follow);
  return () => window.removeEventListener(timerEvent, follow);
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
