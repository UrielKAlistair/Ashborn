/**
 * The "Break down" request: a prompt the user copies into any Claude chat to split a step into next
 * actions. It carries what a stranger would need: the step, where it sits, what it unlocks, when it is
 * due and what it already holds. The reply, one action per line, pastes straight into Split
 * (parseStepList in splitList.ts reads it).
 */
import { isDone, questOf, type GraphModel } from "./graphModel";
import type { Snapshot } from "./types";

export function breakdownPrompt(model: GraphModel, snapshot: Snapshot, nodeId: string): string {
  const node = model.byId.get(nodeId);
  if (!node) return "";
  const quest = questOf(model.byId, node);

  // The boxes it sits in, from its quest down
  const within: string[] = [];
  for (let at = node.parentId ? model.byId.get(node.parentId) : undefined; at; at = at.parentId ? model.byId.get(at.parentId) : undefined) {
    within.unshift(at.title);
  }
  const unlocks = snapshot.edges.filter(({ from }) => from === nodeId).flatMap(({ to }) => model.byId.get(to)?.title ?? []);
  const have = (model.children.get(nodeId) ?? []).filter((step) => !isDone(step)).map((step) => step.title);
  const due = snapshot.deadlines.filter((deadline) => deadline.nodeId === nodeId).map((deadline) => deadline.dueDate).sort()[0];

  return [
    "Help me break a task into small, concrete next actions.",
    "",
    `Task: ${node.title}`,
    ...(quest.id !== node.id ? [`Part of: ${within.join(" > ")}`] : []),
    ...(unlocks.length ? [`Finishing it unlocks: ${unlocks.join("; ")}`] : []),
    ...(due ? [`Due: ${due}`] : []),
    ...(have.length ? [`Steps I already have: ${have.join("; ")}`] : []),
    "",
    "Reply with only the list: 3 to 7 actions, one per line, in the order to do them. Each starts with a verb and is small enough to begin within 15 minutes. No numbering, no commentary.",
  ].join("\n");
}
