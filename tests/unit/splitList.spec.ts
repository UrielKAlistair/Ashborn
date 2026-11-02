import { expect, test } from "@playwright/test";
import { parseStepList } from "../../src/shared/splitList";

test("one step per line, blank lines dropped", () => {
  expect(parseStepList("Read the brief\n\n  Draft slides  \nRehearse\n")).toEqual(["Read the brief", "Draft slides", "Rehearse"]);
});

test("list marks are taken off", () => {
  expect(parseStepList("- one\n* two\n+ three\n• four\n1. five\n2) six\n- [ ] seven\n- [x] eight\n## nine")).toEqual([
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
  ]);
});

test("a number that is part of the title stays", () => {
  expect(parseStepList("2026 budget\n3D print the mount")).toEqual(["2026 budget", "3D print the mount"]);
});

test("Windows line ends", () => {
  expect(parseStepList("a\r\nb")).toEqual(["a", "b"]);
});
