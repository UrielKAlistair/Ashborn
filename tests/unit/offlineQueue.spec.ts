import { expect, test } from "@playwright/test";
import { ServerError } from "../../src/lib/api";
import { QueueHeld, queuedCount, sendQueue, type QueuedChange } from "../../src/lib/offline";
import type { AshbornApi } from "../../src/shared/types";

// The offline queue: what is kept, what is dropped, and changes made while it is being sent

const store = new Map<string, string>();
Object.assign(globalThis, {
  window: { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } },
});
// Node defines navigator without a setter
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

const queueKey = "ashborn-offline-queue";
const setQueue = (changes: QueuedChange[]) => store.set(queueKey, JSON.stringify(changes));
const titles = () => (JSON.parse(store.get(queueKey) ?? "[]") as QueuedChange[]).map((change) => change.args[1]);
const rename = (title: string): QueuedChange => ({ name: "updateNode", args: ["node-1", title], at: new Date().toISOString() });

// An api whose updateNode runs `send` for each change it is given
function apiWith(send: (title: string) => Promise<void>) {
  return () => ({ updateNode: async (_id: string, title: string) => (await send(title), {}) }) as unknown as AshbornApi;
}

test.beforeEach(() => store.clear());

test("a change queued while the queue is being sent is kept and sent too", async () => {
  setQueue([rename("first")]);
  const sent: string[] = [];
  await sendQueue(
    apiWith(async (title) => {
      sent.push(title);
      // Made by the user while the first change was on its way
      if (title === "first") setQueue([...(JSON.parse(store.get(queueKey)!) as QueuedChange[]), rename("made meanwhile")]);
    }),
  );
  expect(sent).toEqual(["first", "made meanwhile"]);
  expect(queuedCount()).toBe(0);
});

test("a change the server can never accept is dropped and reported; the rest are sent", async () => {
  setQueue([rename("refused"), rename("fine")]);
  const refused = await sendQueue(
    apiWith(async (title) => {
      if (title === "refused") throw new ServerError("violates check constraint", "23514", 400);
    }),
  );
  expect(refused).toEqual(["violates check constraint"]);
  expect(queuedCount()).toBe(0);
});

test("a server error that may pass holds the queue, counting tries until it is shown", async () => {
  setQueue([rename("held"), rename("after it")]);
  const unavailable = apiWith(async () => {
    throw new ServerError("Service Unavailable", "", 503);
  });
  for (const tries of [1, 2, 3]) {
    const held = await sendQueue(unavailable).catch((error: unknown) => error);
    expect(held).toBeInstanceOf(QueueHeld);
    expect((held as QueueHeld).tries).toBe(tries);
    expect((held as QueueHeld).shown).toBe(tries >= 3);
  }
  expect(titles()).toEqual(["held", "after it"]);
});

test("a lost connection holds the queue without counting against the change", async () => {
  setQueue([rename("held")]);
  const held = await sendQueue(
    apiWith(async () => {
      throw new TypeError("fetch failed");
    }),
  ).catch((error: unknown) => error);
  expect(held).toBeInstanceOf(QueueHeld);
  expect((held as QueueHeld).tries).toBe(0);
  expect(titles()).toEqual(["held"]);
});
