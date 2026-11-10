import { expect, test } from "@playwright/test";
import { ServerError } from "../../src/lib/api";
import { QueueHeld, queuedCount, sendQueue, unqueue, type QueuedChange } from "../../src/lib/offline";
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

test("a change taken off the queue while it is being sent takes nothing else with it", async () => {
  const first = rename("first");
  setQueue([first, rename("second")]);
  const sent: string[] = [];
  await sendQueue(
    apiWith(async (title) => {
      sent.push(title);
      // Its own request, queued when the connection went, got through meanwhile
      if (title === "first") unqueue(first);
    }),
  );
  expect(sent).toEqual(["first", "second"]);
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

test("a refusal quoting the user's text is a refusal, not a lost connection, whatever the text says", async () => {
  setQueue([rename("refused"), rename("fine")]);
  const refused = await sendQueue(
    apiWith(async (title) => {
      if (title === "refused") throw new ServerError("Network pasta was deleted on another device", "P0001", 400);
    }),
  );
  expect(refused).toEqual(["Network pasta was deleted on another device"]);
  expect(queuedCount()).toBe(0);
});

test("a change refused before the queue is held is still reported, with the hold", async () => {
  setQueue([rename("refused"), rename("held")]);
  const held = await sendQueue(
    apiWith(async (title) => {
      if (title === "refused") throw new ServerError("violates check constraint", "23514", 400);
      throw new TypeError("fetch failed");
    }),
  ).catch((error: unknown) => error);
  expect(held).toBeInstanceOf(QueueHeld);
  expect((held as QueueHeld).refused).toEqual(["violates check constraint"]);
  expect(titles()).toEqual(["held"]);
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

// Errors the app doesn't name as worth trying again drop the change, so none can hold the queue for good
for (const [code, status] of [["21000", 400], ["PGRST102", 400], ["", 400], ["XX000", 500], ["P0002", 400]] as const) {
  test(`an unnamed server error (${code || "no code"}, ${status}) drops the change and sends the rest`, async () => {
    setQueue([rename("refused"), rename("fine")]);
    const sent: string[] = [];
    const refused = await sendQueue(
      apiWith(async (title) => {
        if (title === "refused") throw new ServerError("refused", code, status);
        sent.push(title);
      }),
    );
    expect(refused).toEqual(["refused"]);
    expect(sent).toEqual(["fine"]);
  });
}

for (const [code, status] of [["", 503], ["", 429], ["", 401], ["40001", 500], ["57014", 500], ["PGRST301", 401], ["PGRST204", 400]] as const) {
  test(`a server error that may pass (${code || "no code"}, ${status}) holds the queue`, async () => {
    setQueue([rename("held")]);
    const held = await sendQueue(
      apiWith(async () => {
        throw new ServerError("try later", code, status);
      }),
    ).catch((error: unknown) => error);
    expect(held).toBeInstanceOf(QueueHeld);
    expect(titles()).toEqual(["held"]);
  });
}

test("a change failing for 20 tries over a day is given up on, reported, and the rest are sent", async () => {
  const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  setQueue([{ ...rename("stuck"), tries: 19, failingSince: dayAgo }, rename("fine")]);
  const sent: string[] = [];
  const refused = await sendQueue(
    apiWith(async (title) => {
      if (title === "stuck") throw new ServerError("Service Unavailable", "", 503);
      sent.push(title);
    }),
  );
  expect(refused).toEqual(["Service Unavailable"]);
  expect(sent).toEqual(["fine"]);
});

test("many quick tries within the day still hold the queue", async () => {
  setQueue([{ ...rename("held"), tries: 25, failingSince: new Date(Date.now() - 60_000).toISOString() }]);
  const held = await sendQueue(
    apiWith(async () => {
      throw new ServerError("Service Unavailable", "", 503);
    }),
  ).catch((error: unknown) => error);
  expect(held).toBeInstanceOf(QueueHeld);
  expect(titles()).toEqual(["held"]);
});
