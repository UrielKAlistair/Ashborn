import { expect, test } from "@playwright/test";
import { addDays, today } from "../../src/shared/dates";
import { chooseNow, type NowMemory } from "../../src/shared/nowStep";
import type { GraphNode } from "../../src/shared/types";

const step = (id: string, parentId = "q") => ({ id, parentId, title: id }) as GraphNode;
const steps = [step("a"), step("b"), step("c")];
const date = today();
const now = Date.now();
const memory = (fields: Partial<NowMemory> = {}): NowMemory => ({ passed: [], timer: null, splitFrom: null, holding: null, ...fields });
const pick = (fields: Partial<NowMemory>, list = steps) => chooseNow(list, memory(fields), now, date)?.step.id ?? null;

test("the first of the to-do, or nothing", () => {
  expect(pick({})).toBe("a");
  expect(pick({}, [])).toBeNull();
});

test("before any split, a quest that needs a first step takes its place in the order, not the lead", () => {
  expect(pick({}, [step("urgent"), step("empty quest", null as unknown as string)])).toBe("urgent");
});

test("put off steps are passed; putting off all of them starts the round again", () => {
  expect(pick({ passed: ["a"] })).toBe("b");
  expect(pick({ passed: ["a", "b", "c"] })).toBe("a");
  // The round restarted, so the first Not now after it puts off "a" alone, not everything again
  expect(chooseNow(steps, memory({ passed: ["a", "b", "c"] }), now, date)?.passed).toEqual([]);
});

test("a running timer holds Now, and so does one that ended today; one from an earlier day doesn't", () => {
  const box = (endsAt: number) => ({ stepId: "c", startedAt: endsAt - 60_000, endsAt });
  expect(pick({ timer: box(now + 60_000) })).toBe("c");
  expect(pick({ timer: box(now - 60_000) })).toBe("c");
  const days = (n: number) => new Date(`${addDays(date, n)}T12:00:00`).getTime();
  expect(pick({ timer: box(days(-3)) })).toBe("a");
  expect(chooseNow(steps, memory({ timer: box(days(-3)) }), now, date)?.timed).toBeNull();
});

test("Split open holds its step, ahead of a timer; the steps just split come next", () => {
  expect(pick({ holding: "b", timer: { stepId: "c", startedAt: now, endsAt: now + 60_000 } })).toBe("b");
  expect(pick({ splitFrom: "c" }, [step("a"), step("c1", "c"), step("c2", "c")])).toBe("c1");
  // A held step gone from the to-do holds nothing
  expect(pick({ holding: "gone" })).toBe("a");
});
