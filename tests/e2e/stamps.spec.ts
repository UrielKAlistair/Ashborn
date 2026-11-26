import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createApi } from "../../src/lib/api";

// Per field the change made later wins, however late an earlier one arrives: also when the later
// change left the value as it was, and for moves and placements, which are stamped when made, not
// when sent. Two devices, through the API with set clocks.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const HOUR_MS = 60 * 60 * 1000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR_MS);
// A device whose changes were made at `made` (an offline one replays them with that time)
const deviceAt = (made: Date) => createApi(db, () => made);

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  const { error: wipeError } = await db.from("graph_nodes").delete().not("id", "is", null);
  if (wipeError) throw wipeError;
});

const node = async (id: string) => (await db.from("graph_nodes").select("title, parent_id, x, y").eq("id", id).single()).data!;
const links = async (id: string) => (await db.from("graph_edges").select("from_id, to_id").or(`from_id.eq.${id},to_id.eq.${id}`)).data!;

test("a later change that leaves the value as it was still beats an earlier one sent after it", async () => {
  const [id] = [crypto.randomUUID()];
  await deviceAt(hoursAgo(3)).createNode("Draft", null, id);
  await deviceAt(hoursAgo(3)).updateNode(id, { title: "Draft" });
  // B, an hour ago, sets the title it already has; A's rename from two hours ago arrives now
  await deviceAt(hoursAgo(1)).updateNode(id, { title: "Draft" });
  await deviceAt(hoursAgo(2)).updateNode(id, { title: "Renamed offline" });
  expect((await node(id)).title).toBe("Draft");
});

test("a move made earlier but sent later loses to the one made later, and keeps the node's links", async () => {
  const [quest, other, step, next] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const setup = deviceAt(hoursAgo(3));
  await setup.createNode("Quest", null, quest);
  await setup.createNode("Other quest", null, other);
  await setup.createNode("Step", quest, step);
  await setup.createNode("Next step", quest, next);
  await setup.addEdge({ from: step, to: next });
  // B, an hour ago, moves the step out to the top; A's move into the other quest, from two hours ago, arrives now
  await deviceAt(hoursAgo(1)).moveNode(step, null);
  await setup.addEdge({ from: step, to: other });
  await deviceAt(hoursAgo(2)).moveNode(step, other);
  expect((await node(step)).parent_id).toBeNull();
  expect(await links(step)).toEqual([{ from_id: step, to_id: other }]);
});

test("a box's tick that lost to a later untick ticks nothing inside it", async () => {
  const [box, step] = [crypto.randomUUID(), crypto.randomUUID()];
  const setup = deviceAt(hoursAgo(3));
  await setup.createNode("Box", null, box);
  await setup.createNode("Step inside", box, step);
  // B, an hour ago, ticks the box and unticks it; A's tick from two hours ago arrives now
  await deviceAt(hoursAgo(1)).updateNode(box, { done: false });
  const { nodes } = await deviceAt(hoursAgo(2)).updateNode(box, { done: true });
  const done = async (id: string) => (await db.from("graph_nodes").select("completed_at").eq("id", id).single()).data!.completed_at;
  expect(await done(box)).toBeNull();
  expect(await done(step)).toBeNull();
  expect(nodes.map(({ id }) => id)).toEqual([box]);
});

test("a tick replayed on a step already done keeps the day it was done on", async () => {
  const step = crypto.randomUUID();
  await deviceAt(hoursAgo(30)).createNode("Ticked yesterday", null, step);
  // A ticks it 26 hours ago; B's own tick of it, made an hour ago and queued offline, arrives now
  const ticked = hoursAgo(26);
  await deviceAt(ticked).updateNode(step, { done: true });
  const { nodes } = await deviceAt(hoursAgo(1)).updateNode(step, { done: true });
  const { data } = await db.from("graph_nodes").select("completed_at").eq("id", step).single();
  expect(Date.parse(data!.completed_at)).toBe(ticked.getTime());
  expect(Date.parse(nodes![0].completedAt!)).toBe(ticked.getTime());
});

test("a deadline done on another device leaves when changed or its create is replayed, never comes back as open", async () => {
  const [deadline, quest] = [crypto.randomUUID(), crypto.randomUUID()];
  const create = { id: deadline, title: "Hand in the form", dueDate: "2099-01-01", alarmTime: null, nodeId: null };
  await deviceAt(hoursAgo(3)).createNode("Quest", null, quest);
  await deviceAt(hoursAgo(3)).createDeadline(create);
  await deviceAt(hoursAgo(2)).completeDeadline(deadline);
  expect(await deviceAt(hoursAgo(1)).updateDeadline(deadline, { nodeId: quest })).toEqual({ removedDeadlineIds: [deadline] });
  expect(await deviceAt(hoursAgo(3)).createDeadline(create)).toEqual({ removedDeadlineIds: [deadline] });
  await db.from("deadlines").delete().eq("id", deadline);
});
