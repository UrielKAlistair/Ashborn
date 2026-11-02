import { expect, test } from "@playwright/test";
import { buildGraphModel } from "../../src/shared/graphModel";
import { likelyQuest } from "../../src/shared/likelyQuest";
import type { GraphNode, Snapshot } from "../../src/shared/types";

const quest = (id: string, title: string, extra: Partial<GraphNode> = {}) =>
  ({ id, parentId: null, title, statWeights: {}, color: null, active: true, createdAt: "2026-10-20T00:00:00", completedAt: null, shelved: false, priority: null, ownXp: 0, lastActive: "2026-10-20T00:00:00", stamps: {}, position: null, ...extra }) as GraphNode;

const pick = (title: string, quests: GraphNode[]) =>
  likelyQuest(buildGraphModel({ nodes: quests, edges: [] } as unknown as Snapshot), title, "inbox")?.id ?? null;

const quests = [quest("bsc", "Online BSc"), quest("ddp", "DDP Work"), quest("errands", "Errands"), quest("inbox", "Inbox")];

test("the quest whose whole title the deadline names", () => {
  expect(pick("Online BSc quiz", quests)).toBe("bsc");
  expect(pick("DDP Work: final presentation", quests)).toBe("ddp");
  expect(pick("Thesis draft", [quest("a", "Thesis"), quest("b", "Thesis draft")])).toBe("b");
});

test("one shared ordinary word is no guess", () => {
  expect(pick("DDP presentation", quests)).toBeNull();
  expect(pick("Pay electricity bill", [quest("rent", "Pay rent")])).toBeNull();
  expect(pick("Submit report online", quests)).toBeNull();
});

test("no shared word, no guess: short and common words don't count", () => {
  expect(pick("Science fest judge review", quests)).toBeNull();
  expect(pick("Do the work by Friday", [quest("a", "The plan")])).toBeNull();
});

test("a tie is no guess, and hidden, shelved, done quests and the Inbox are never one", () => {
  expect(pick("Thesis draft", [quest("a", "Thesis"), quest("b", "Draft")])).toBeNull();
  expect(pick("Inbox zero", quests)).toBeNull();
  expect(pick("Online BSc quiz", [quest("bsc", "Online BSc", { shelved: true })])).toBeNull();
  expect(pick("Online BSc quiz", [quest("bsc", "Online BSc", { active: false })])).toBeNull();
  expect(pick("Online BSc quiz", [quest("bsc", "Online BSc", { completedAt: "2026-11-01T00:00:00" })])).toBeNull();
});
