// Which step Now shows, from the to-do and what Now remembers. Pure, so the app can mirror it to the
// tray and the graph on any screen, and the card on Home draws the same choice.

import { dayOf } from "./dates";
import type { GraphNode, ISODate } from "./types";

export type StartTimer = { stepId: string; startedAt: number; endsAt: number };

export type NowMemory = {
  passed: string[]; // put off with Not now today
  timer: StartTimer | null;
  splitFrom: string | null; // the step last split from Now: its new steps come next
  holding: string | null; // the step Split is open on, held there until it closes
};

export type NowChoice = { step: GraphNode; timed: StartTimer | null; passed: string[] };

// In order: the step Split is open on; a started step while its time runs, and through the rest of the
// day it ended in, so "Done, or keep going?" waits for an answer but not for ever; a new step of the one
// just split; the first not put off. Putting off every step starts the round again.
export function chooseNow(steps: GraphNode[], { passed, timer, splitFrom, holding }: NowMemory, clock: number, date: ISODate): NowChoice | null {
  if (steps.length === 0) return null;
  const held = holding ? steps.find(({ id }) => id === holding) : undefined;
  const live = timer && (timer.endsAt > clock || dayOf(new Date(timer.endsAt)) === date) ? timer : null;
  const timedStep = live ? steps.find(({ id }) => id === live.stepId) : undefined;
  const waiting = steps.filter(({ id }) => !passed.includes(id));
  const round = waiting.length > 0 ? waiting : steps;
  const step = held ?? timedStep ?? round.find(({ parentId }) => parentId === splitFrom) ?? round[0];
  return { step, timed: timedStep && step.id === timedStep.id ? live : null, passed: waiting.length > 0 ? passed : [] };
}
