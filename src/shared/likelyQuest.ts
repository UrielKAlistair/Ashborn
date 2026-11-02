// The quest a deadline names, so linking it is one tap: one whose every title word is in the deadline's
// ("Online BSc" in "Online BSc quiz"). One shared ordinary word ("Pay rent", "Pay the bill") isn't enough;
// nothing when no quest qualifies, or two fit as well.

import { isDone, type GraphModel } from "./graphModel";
import type { GraphNode } from "./types";

// Words this short, or this common, say nothing about which quest is meant
const MIN_WORD = 3;
const COMMON = new Set(["the", "and", "for", "with", "from", "into", "about", "due"]);

export function likelyQuest(model: GraphModel, title: string, inboxId: string): GraphNode | null {
  const wanted = new Set(words(title));
  const scored = (model.children.get(null) ?? [])
    .filter((quest) => quest.active && !quest.shelved && !isDone(quest) && quest.id !== inboxId)
    .map((quest) => ({ quest, named: words(quest.title) }))
    .filter(({ named }) => named.length > 0 && named.every((word) => wanted.has(word)))
    .map(({ quest, named }) => ({ quest, shared: named.length }))
    .sort((a, b) => b.shared - a.shared);
  if (scored.length === 0 || scored[1]?.shared === scored[0].shared) return null;
  return scored[0].quest;
}

function words(text: string) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= MIN_WORD && !COMMON.has(word));
}
