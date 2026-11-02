// The quest a deadline most likely belongs to, by the words their titles share ("Online BSc quiz" and
// "Online BSc"), so linking it is one tap; nothing when no quest shares a word, or two share as many.

import { isDone, type GraphModel } from "./graphModel";
import type { GraphNode } from "./types";

// Words this short, or this common, say nothing about which quest is meant
const MIN_WORD = 3;
const COMMON = new Set(["the", "and", "for", "with", "from", "into", "about", "due"]);

export function likelyQuest(model: GraphModel, title: string, inboxId: string): GraphNode | null {
  const wanted = new Set(words(title));
  const scored = (model.children.get(null) ?? [])
    .filter((quest) => quest.active && !quest.shelved && !isDone(quest) && quest.id !== inboxId)
    .map((quest) => ({ quest, shared: words(quest.title).filter((word) => wanted.has(word)).length }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared);
  if (scored.length === 0 || scored[1]?.shared === scored[0].shared) return null;
  return scored[0].quest;
}

function words(text: string) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= MIN_WORD && !COMMON.has(word));
}
