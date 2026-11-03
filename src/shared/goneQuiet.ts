// Gone quiet: quests with open steps that nothing has touched for a week, and which aren't on the
// to-do, so they would otherwise drop out of mind unnoticed.

import { dayOf, daysBetween } from "./dates";
import { isDone, type GraphModel } from "./graphModel";
import type { Priorities } from "./priority";
import type { GraphNode, ISODate, Priority, Snapshot } from "./types";

export const QUIET_DAYS = 7;

export type QuietQuest = { quest: GraphNode; days: number; openSteps: number; priority: Priority | undefined };

// Longest quiet first
export function goneQuiet(model: GraphModel, snapshot: Snapshot, { effective, best }: Priorities, date: ISODate): QuietQuest[] {
  const quests = (model.children.get(null) ?? []).filter((quest) => quest.active && !isDone(quest) && !model.shelved.has(quest.id) && quest.id !== snapshot.inboxId);
  return quests
    .flatMap((quest) => {
      const inside = stepsInside(model, quest.id);
      // Steps only: a box that groups steps is not one more thing to do
      const open = inside.filter((step) => !model.children.has(step.id) && !isDone(step) && !model.shelved.has(step.id));
      if (open.length === 0 || open.some((step) => model.ready.has(step.id) && effective.has(step.id))) return [];
      const latest = Math.max(...[quest, ...inside].map((node) => Date.parse(node.lastActive)));
      const days = daysBetween(dayOf(new Date(latest)), date);
      return days >= QUIET_DAYS ? [{ quest, days, openSteps: open.length, priority: best.get(quest.id) }] : [];
    })
    .sort((a, b) => b.days - a.days);
}

function stepsInside(model: GraphModel, id: string): GraphNode[] {
  return (model.children.get(id) ?? []).flatMap((step) => [step, ...stepsInside(model, step.id)]);
}
