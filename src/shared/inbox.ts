// The Inbox: one quest holding thoughts captured without choosing where they go. Its id is the
// user's own (Snapshot.inboxId), so every device names the same quest, even offline.

import { questOf, type GraphModel } from "./graphModel";
import type { GraphNode } from "./types";

export const INBOX_TITLE = "Inbox";

export function inInbox(model: GraphModel, node: GraphNode, inboxId: string) {
  return questOf(model.byId, node).id === inboxId;
}

// Quests in the given order, the Inbox last
export function inboxLast(quests: GraphNode[], inboxId: string) {
  return [...quests.filter((quest) => quest.id !== inboxId), ...quests.filter((quest) => quest.id === inboxId)];
}
