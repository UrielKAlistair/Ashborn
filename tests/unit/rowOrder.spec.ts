import { expect, test } from "@playwright/test";
import { keyedQueue } from "../../src/lib/api";

// Changes to the same row are sent one after another; changes to different rows at once

const after = (ms: number, log: string[], entry: string, fail = false) => () =>
  new Promise<string>((resolve, reject) =>
    setTimeout(() => {
      log.push(entry);
      if (fail) reject(new Error(entry));
      else resolve(entry);
    }, ms),
  );

test("a later change to the same row waits for an earlier, slower one", async () => {
  const queue = keyedQueue();
  const log: string[] = [];
  await Promise.all([queue(["node:a"], after(40, log, "colour")), queue(["node:a"], after(1, log, "hide"))]);
  expect(log).toEqual(["colour", "hide"]);
});

test("changes to different rows do not wait for each other", async () => {
  const queue = keyedQueue();
  const log: string[] = [];
  await Promise.all([queue(["node:a"], after(40, log, "slow a")), queue(["node:b"], after(1, log, "quick b"))]);
  expect(log).toEqual(["quick b", "slow a"]);
});

test("a change touching several rows waits for each of them", async () => {
  const queue = keyedQueue();
  const log: string[] = [];
  await Promise.all([
    queue(["node:a"], after(30, log, "a")),
    queue(["node:b"], after(10, log, "b")),
    queue(["node:a", "node:b"], after(1, log, "both")),
  ]);
  expect(log).toEqual(["b", "a", "both"]);
});

test("a failed change does not block the next, and its caller still sees the failure", async () => {
  const queue = keyedQueue();
  const log: string[] = [];
  const failed = queue(["node:a"], after(10, log, "refused", true));
  const next = queue(["node:a"], after(1, log, "next"));
  await expect(failed).rejects.toThrow("refused");
  await expect(next).resolves.toBe("next");
  expect(log).toEqual(["refused", "next"]);
});
