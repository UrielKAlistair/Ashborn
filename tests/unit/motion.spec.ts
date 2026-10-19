import { expect, test } from "@playwright/test";
import { situpCounter, stepCounter, type MotionSample } from "../../src/lib/motion";

// The alarm challenges' counters, on synthetic accelerometer traces

const still = (t: number): MotionSample => ({ x: 0, y: 0, z: 9.81, t });

test("walking: one count per stride spike, none for standing still or fast shaking", () => {
  const count = stepCounter();
  let steps = 0;
  // Ten strides 500 ms apart: a 13 m/s² spike, then back to rest
  for (let stride = 0; stride < 10; stride++) {
    const t = stride * 500;
    count(still(t));
    count({ x: 2, y: 3, z: 12.5, t: t + 100 });
    steps = count(still(t + 200));
  }
  expect(steps).toBe(10);

  // Spikes 100 ms apart are shaking: only every third or so clears the minimum gap
  const shaking = stepCounter();
  let shaken = 0;
  for (let i = 0; i < 30; i++) {
    shaking({ x: 2, y: 3, z: 12.5, t: 10_000 + i * 100 });
    shaken = shaking(still(10_000 + i * 100 + 50));
  }
  expect(shaken).toBeLessThanOrEqual(10);

  const standing = stepCounter();
  let none = 0;
  for (let t = 0; t < 5000; t += 50) none = standing(still(t));
  expect(none).toBe(0);
});

test("sit-ups: up past 60° and back below 25° counts one; half-way does not", () => {
  const count = situpCounter();
  const tilted = (degrees: number, t: number): MotionSample => {
    const radians = (degrees * Math.PI) / 180;
    return { x: 0, y: 9.81 * Math.sin(radians), z: 9.81 * Math.cos(radians), t };
  };
  let situps = 0;
  for (let rep = 0; rep < 5; rep++) {
    for (const degrees of [0, 30, 70, 30, 10]) situps = count(tilted(degrees, rep * 1000));
  }
  expect(situps).toBe(5);

  // Only reaching 45° never counts
  const lazy = situpCounter();
  let lazyCount = 0;
  for (let rep = 0; rep < 5; rep++) for (const degrees of [0, 45, 0]) lazyCount = lazy(tilted(degrees, rep * 1000));
  expect(lazyCount).toBe(0);
});
