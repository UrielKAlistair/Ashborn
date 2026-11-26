import { expect, test } from "@playwright/test";
import { layeredLayout, type LaidOutStep } from "../../src/shared/layeredLayout";
import type { GraphEdge, Point } from "../../src/shared/types";

const spacing = { step: 12, layer: 48, component: 12 };
const step = (id: string, width = 248, height = 40): LaidOutStep => ({ id, size: { width, height } });
const link = (from: string, to: string): GraphEdge => ({ from, to });

function expectApart(steps: LaidOutStep[], positions: Record<string, Point>) {
  steps.forEach((a, i) =>
    steps.slice(i + 1).forEach((b) => {
      const [p, q] = [positions[a.id], positions[b.id]];
      const apart =
        p.x + a.size.width <= q.x || q.x + b.size.width <= p.x || p.y + a.size.height <= q.y || q.y + b.size.height <= p.y;
      expect(apart, `${a.id} and ${b.id} overlap`).toBe(true);
    }),
  );
}

test("a chain runs left to right on one row", () => {
  const steps = [step("a"), step("b"), step("c")];
  const at = layeredLayout(steps, [link("a", "b"), link("b", "c")], "RIGHT", spacing);
  expect(at).toEqual({ a: { x: 0, y: 0 }, b: { x: 296, y: 0 }, c: { x: 592, y: 0 } });
});

test("on the phone a chain runs top to bottom", () => {
  const steps = [step("a"), step("b")];
  const at = layeredLayout(steps, [link("a", "b")], "DOWN", spacing);
  expect(at).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 88 } });
});

test("unlinked steps stack in priority order", () => {
  const steps = [step("first"), step("second"), step("third")];
  const at = layeredLayout(steps, [], "RIGHT", spacing);
  expect([at.first.y, at.second.y, at.third.y]).toEqual([0, 52, 104]);
  expect(new Set(Object.values(at).map(({ x }) => x))).toEqual(new Set([0]));
});

test("an unlinked step comes after the chains before it in priority order, not above them", () => {
  const steps = [step("a"), step("b"), step("loose")];
  const at = layeredLayout(steps, [link("a", "b")], "RIGHT", spacing);
  expect(at.loose.y).toBeGreaterThan(at.a.y);
});

test("every link points forward", () => {
  const steps = ["a", "b", "c", "d", "e"].map((id) => step(id));
  const links = [link("a", "c"), link("b", "c"), link("c", "e"), link("d", "e")];
  const at = layeredLayout(steps, links, "RIGHT", spacing);
  links.forEach(({ from, to }) => expect(at[from].x).toBeLessThan(at[to].x));
});

test("a step with no prerequisites sits just before what it leads to", () => {
  // d leads only to the last step of a long chain
  const steps = ["a", "b", "c", "d"].map((id) => step(id));
  const at = layeredLayout(steps, [link("a", "b"), link("b", "c"), link("d", "c")], "RIGHT", spacing);
  expect(at.d.x).toBe(at.b.x);
});

test("two crossing chains are untangled", () => {
  // In priority order the layers read [a, b] then [y, x], with a→x and b→y crossing
  const steps = ["a", "b", "y", "x"].map((id) => step(id));
  const at = layeredLayout(steps, [link("a", "x"), link("b", "y"), link("a", "y")], "RIGHT", spacing);
  expect(at.x.y).toBeLessThan(at.y.y);
});

test("steps of different sizes never overlap, and the same input gives the same layout", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let round = 0; round < 40; round++) {
    const count = 2 + Math.floor(random() * 10);
    const steps = Array.from({ length: count }, (_, i) => step(`s${i}`, 200 + Math.floor(random() * 200), 40 + Math.floor(random() * 120)));
    // Links only from earlier to later steps, so there is no loop
    const links = steps.flatMap((a, i) => steps.slice(i + 1).flatMap((b) => (random() < 0.25 ? [link(a.id, b.id)] : [])));
    for (const direction of ["RIGHT", "DOWN"] as const) {
      const at = layeredLayout(steps, links, direction, spacing);
      expectApart(steps, at);
      Object.values(at).forEach(({ x, y }) => expect(x >= 0 && y >= 0).toBe(true));
      expect(layeredLayout(steps, links, direction, spacing)).toEqual(at);
    }
  }
});
