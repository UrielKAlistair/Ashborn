import { useSyncExternalStore } from "react";

// Work not yet saved (a recipe being edited), so leaving its screen or quitting the desktop app asks
// first: Save, Discard, or stay. One holder at a time; `save` resolves true once saved, false if it
// couldn't be (the editor then shows why); `discard` closes the editor, which may stay on screen.
export type Unsaved = { what: string; save: () => Promise<boolean>; discard: () => void };
// The question on screen: leave (true) or stay (false)
type Question = { what: string; answer: (leave: boolean) => void };

let holder: Unsaved | null = null;
let question: Question | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

// Holds `unsaved` until the returned release is called
export function holdUnsaved(unsaved: Unsaved) {
  holder = unsaved;
  window.ashborn?.setUnsaved?.(unsaved.what);
  return () => {
    if (holder !== unsaved) return;
    holder = null;
    window.ashborn?.setUnsaved?.(null);
  };
}

// Asks before leaving the unsaved work, if there is any: true to go on (saved or discarded)
export function askToLeave(): Promise<boolean> {
  if (!holder) return Promise.resolve(true);
  if (question) return Promise.resolve(false);
  return new Promise((resolve) => {
    question = {
      what: holder!.what,
      answer: (leave) => {
        question = null;
        changed();
        resolve(leave);
      },
    };
    changed();
  });
}

// The answers the dialog offers
export async function saveAndLeave() {
  const leave = (await holder?.save()) ?? true;
  question?.answer(leave);
}
export function discardAndLeave() {
  holder?.discard();
  holder = null;
  window.ashborn?.setUnsaved?.(null);
  question?.answer(true);
}
export const stay = () => question?.answer(false);

// The desktop app asks to save before it quits
export const saveForQuit = async () => (await holder?.save()) ?? true;

export function useQuestion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => question,
  );
}
