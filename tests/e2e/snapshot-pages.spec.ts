import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createApi } from "../../src/lib/api";

// The server returns at most 1000 rows a request, and a request's address has a limited length; the
// snapshot still holds the whole graph, and a box's tick reaches every step in it.

const db = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!);
const COUNT = 1005;

test.beforeEach(async () => {
  const { error } = await db.auth.signInWithPassword({ email: process.env.E2E_EMAIL!, password: process.env.E2E_PASSWORD! });
  if (error) throw error;
  const { error: wipeError } = await db.from("graph_nodes").delete().not("id", "is", null);
  if (wipeError) throw wipeError;
});

test("a graph of more than one page is read whole", async () => {
  const quest = crypto.randomUUID();
  const steps = Array.from({ length: COUNT - 1 }, (_, index) => ({ id: crypto.randomUUID(), title: `Step ${index}`, parent_id: quest }));
  const { error: insertError } = await db.from("graph_nodes").insert([{ id: quest, title: "Big quest", parent_id: null }, ...steps]);
  if (insertError) throw insertError;
  const { error: edgeError } = await db.from("graph_edges").insert(steps.slice(1).map((step, index) => ({ from_id: steps[index].id, to_id: step.id })));
  if (edgeError) throw edgeError;

  const snapshot = await createApi(db).getSnapshot();
  expect(snapshot.nodes).toHaveLength(COUNT);
  expect(new Set(snapshot.nodes.map(({ id }) => id)).size).toBe(snapshot.nodes.length);
  expect(snapshot.edges).toHaveLength(COUNT - 2);
});

test("a box with more open steps than one request carries is ticked whole", async () => {
  const box = crypto.randomUUID();
  const steps = Array.from({ length: 250 }, (_, index) => ({ id: crypto.randomUUID(), title: `Problem ${index}`, parent_id: box }));
  const { error } = await db.from("graph_nodes").insert([{ id: box, title: "Problem set", parent_id: null }, ...steps]);
  if (error) throw error;
  const { nodes } = await createApi(db).updateNode(box, { done: true });
  expect(nodes).toHaveLength(steps.length + 1);
  const { count } = await db.from("graph_nodes").select("*", { count: "exact", head: true }).eq("parent_id", box).is("completed_at", null);
  expect(count).toBe(0);
});

test.afterAll(async () => {
  await db.from("graph_nodes").delete().not("id", "is", null);
});
