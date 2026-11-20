// Gone quiet: quests with open steps that nothing has touched for a while, so they would otherwise drop
// out of mind unnoticed. A quest on the to-do counts too: a step listed every day and never acted on is
// the quietest kind. A P1 quest is quiet sooner than the rest.

import { daysBetween, toISODate } from "./dates";
import { isDone, type GraphModel } from "./graphModel";
import type { Priorities } from "./priority";
import type { GraphNode, ISODate, Priority } from "./types";

// Days untouched before a quest counts as quiet: a P1 quest's, and every other's
export const QUIET_DAYS_P1 = 3;
export const QUIET_DAYS = 7;

export type QuietQuest = { quest: GraphNode; days: number; openSteps: number; priority: Priority | undefined };

// Most urgent first (by the best priority inside the quest, none last), then longest quiet
export function goneQuiet(model: GraphModel, { best }: Priorities, date: ISODate): QuietQuest[] {
  const quests = (model.children.get(null) ?? []).filter((quest) => !isDone(quest) && !model.shelved.has(quest.id));
  return quests
    .flatMap((quest) => {
      const inside = stepsInside(model, quest.id);
      // Steps only: a box that groups steps is not one more thing to do
      const open = inside.filter((step) => !model.children.has(step.id) && !isDone(step) && !model.shelved.has(step.id));
      if (open.length === 0) return [];
      const latest = Math.max(...[quest, ...inside].map((node) => Date.parse(node.lastActive)));
      const days = daysBetween(toISODate(new Date(latest)), date);
      const priority = best.get(quest.id);
      return days >= (priority === 1 ? QUIET_DAYS_P1 : QUIET_DAYS) ? [{ quest, days, openSteps: open.length, priority }] : [];
    })
    .sort((a, b) => (a.priority ?? 5) - (b.priority ?? 5) || b.days - a.days);
}

function stepsInside(model: GraphModel, id: string): GraphNode[] {
  return (model.children.get(id) ?? []).flatMap((step) => [step, ...stepsInside(model, step.id)]);
}
