import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createApi } from "../../src/lib/api";

// A box is done only while everything in it is (design 205): a step opened, added or moved inside done
// boxes reopens them, and only them. Through the API, as the app and the connector write.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const api = createApi(db);
const done = async (id: string) => Boolean((await db.from("graph_nodes").select("completed_at").eq("id", id).single()).data!.completed_at);
const id = { quest: crypto.randomUUID(), box: crypto.randomUUID(), inner: crypto.randomUUID(), a: crypto.randomUUID(), b: crypto.randomUUID(), loose: crypto.randomUUID() };

test.beforeAll(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  await db.from("graph_nodes").delete().not("id", "is", null);
  await api.createNode("Quest", null, id.quest);
  await api.createNode("Two pointers", id.quest, id.box);
  await api.createNode("Harder ones", id.box, id.inner);
  await api.createNode("Problem A", id.inner, id.a);
  await api.createNode("Problem B", id.box, id.b);
  await api.createNode("Loose step", id.quest, id.loose);
});

test("reopening a step reopens the done boxes around it, not its siblings", async () => {
  await api.updateNode(id.box, { done: true });
  expect(await done(id.a)).toBe(true);
  const { nodes } = await api.updateNode(id.a, { done: false });
  expect(nodes!.map(({ id }) => id).sort()).toEqual([id.a, id.box, id.inner].sort());
  for (const each of [id.a, id.inner, id.box]) expect(await done(each)).toBe(false);
  expect(await done(id.b)).toBe(true);
});

test("a step added inside a done box reopens it", async () => {
  await api.updateNode(id.box, { done: true });
  await api.createNode("Problem C", id.inner);
  expect(await done(id.inner)).toBe(false);
  expect(await done(id.box)).toBe(false);
});

test("a step moved into a done box reopens it", async () => {
  await api.updateNode(id.box, { done: true });
  await api.moveNode(id.loose, id.box);
  expect(await done(id.box)).toBe(false);
});

test.afterAll(async () => {
  await db.from("graph_nodes").delete().not("id", "is", null);
});
