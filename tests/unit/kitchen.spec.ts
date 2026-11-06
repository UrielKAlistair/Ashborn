import { expect, test } from "@playwright/test";
import { previewChange } from "../../src/lib/offline";
import { cooked, emptyKitchen, fromBase, mealDeductions, mealReminders, read, recipeProblems, reminderOffsets, sameKind, shownMeal, toBase, uncooked } from "../../src/shared/kitchen";
import type { Kitchen, Recipe, RecipeReminder, Snapshot, StockItem } from "../../src/shared/types";

// The Kitchen's rules: units, stock arithmetic, the default week, deductions and reminder times

const rice: StockItem = { id: "rice", name: "Rice", unit: "kg", target: 2000, onHand: 1500, readAt: null };
const beans: StockItem = { id: "beans", name: "Butter beans", unit: "g", target: 1000, onHand: 800, readAt: null };
const reminder = (id: string, offsetMinutes: number, anchorId: string | null = null): RecipeReminder => ({ id, label: id, offsetMinutes, anchorId });
const riceAndBeans: Recipe = {
  id: "rb",
  title: "Rice and beans",
  body: "",
  ingredients: [
    { id: "i1", itemId: "rice", name: "rice", amount: 200, unit: "g" },
    { id: "i2", itemId: "beans", name: "butter beans", amount: 150, unit: "g" },
    { id: "i3", itemId: null, name: "coconut milk", amount: 200, unit: "ml" },
  ],
  reminders: [reminder("prep", -45)],
};
const kitchen = (overrides: Partial<Kitchen> = {}): Kitchen => ({
  items: [rice, beans],
  recipes: [riceAndBeans],
  defaultWeek: [],
  meals: [],
  mealChanges: [],
  ...overrides,
});
const onHand = (state: Kitchen, id: string) => state.items.find((item) => item.id === id)!.onHand;

// 2026-10-20 is a Tuesday
const tuesday = "2026-10-20";
const noon = "2026-10-20T12:00:00.000Z";

test("units convert within a kind only", () => {
  expect(toBase(2, "kg")).toBe(2000);
  expect(fromBase(1500, "kg")).toBe(1.5);
  expect(toBase(0.5, "l")).toBe(500);
  expect(sameKind("g", "kg")).toBe(true);
  expect(sameKind("ml", "l")).toBe(true);
  expect(sameKind("g", "ml")).toBe(false);
  expect(sameKind("count", "g")).toBe(false);
});

test("a recipe with a unit of the wrong kind, or a reminder loop, is refused", () => {
  expect(recipeProblems(riceAndBeans, [rice, beans])).toEqual([]);
  const wrongKind = { ...riceAndBeans, ingredients: [{ id: "i1", itemId: "rice", name: "rice", amount: 200, unit: "ml" as const }] };
  expect(recipeProblems(wrongKind, [rice, beans])).toEqual(["rice: Rice is counted in kg, so ml cannot be used."]);
  const loop = { ...riceAndBeans, reminders: [reminder("a", 10, "b"), reminder("b", 10, "a")] };
  expect(recipeProblems(loop, [rice, beans])).toEqual(["The reminders are timed from each other in a loop."]);
  const missingAnchor = { ...riceAndBeans, reminders: [reminder("a", 10, "gone")] };
  expect(recipeProblems(missingAnchor, [rice, beans])).toHaveLength(1);
});

test("an untouched date shows the default week; a planned date overrides it for that date only", () => {
  const defaultWeek = [{ weekday: "Tue" as const, slot: "lunch" as const, description: "rice and beans", recipeIds: ["rb"] }];
  const planned = { id: "m1", date: tuesday, slot: "lunch" as const, description: "pasta", status: "planned" as const, recipeIds: [] };
  expect(shownMeal(kitchen({ defaultWeek }), tuesday, "lunch")).toMatchObject({ description: "rice and beans", recipeIds: ["rb"], fromDefault: true });
  expect(shownMeal(kitchen({ defaultWeek, meals: [planned] }), tuesday, "lunch")).toMatchObject({ description: "pasta", fromDefault: false });
  expect(shownMeal(kitchen({ defaultWeek, meals: [planned] }), "2026-10-27", "lunch")).toMatchObject({ description: "rice and beans" });
  expect(shownMeal(kitchen(), tuesday, "dinner")).toMatchObject({ description: "", recipeIds: [], fromDefault: true });
});

test("cooking deducts tracked ingredients in the item's base unit and names the untracked ones", () => {
  expect(mealDeductions(kitchen(), { recipeIds: ["rb"] })).toEqual({
    changes: [
      { itemId: "rice", amount: -200 },
      { itemId: "beans", amount: -150 },
    ],
    untracked: ["coconut milk"],
  });
});

test("cooking then uncooking restores stock exactly, even after the recipe changed in between", () => {
  const planned = { id: "m1", date: tuesday, slot: "lunch" as const, description: "rice and beans", status: "planned" as const, recipeIds: ["rb"] };
  const afterCooking = cooked(kitchen({ meals: [planned] }), tuesday, "lunch", "unused", noon);
  expect(onHand(afterCooking, "rice")).toBe(1300);
  expect(onHand(afterCooking, "beans")).toBe(650);
  expect(afterCooking.meals[0].status).toBe("cooked");

  const doubled = { ...riceAndBeans, ingredients: riceAndBeans.ingredients.map((i) => ({ ...i, amount: i.amount * 2 })) };
  const afterUncooking = uncooked({ ...afterCooking, recipes: [doubled] }, tuesday, "lunch");
  expect(onHand(afterUncooking, "rice")).toBe(1500);
  expect(onHand(afterUncooking, "beans")).toBe(800);
  expect(afterUncooking.mealChanges).toEqual([]);
  expect(afterUncooking.meals[0].status).toBe("planned");
});

test("cooking twice replaces the first deduction; cooking a default-week meal copies it", () => {
  const defaultWeek = [{ weekday: "Tue" as const, slot: "lunch" as const, description: "rice and beans", recipeIds: ["rb"] }];
  const once = cooked(kitchen({ defaultWeek }), tuesday, "lunch", "new-id", noon);
  expect(once.meals).toEqual([{ id: "new-id", date: tuesday, slot: "lunch", description: "rice and beans", status: "cooked", recipeIds: ["rb"] }]);
  const twice = cooked(once, tuesday, "lunch", "other-id", noon);
  expect(onHand(twice, "rice")).toBe(1300);
  expect(twice.meals).toHaveLength(1);
});

test("a reading sets the amount on hand; meals cooked after it still count, an older reading changes nothing", () => {
  const planned = { id: "m1", date: tuesday, slot: "lunch" as const, description: "rice", status: "planned" as const, recipeIds: ["rb"] };
  const counted = read(kitchen({ meals: [planned] }), "rice", 4900, "2026-10-20T10:00:00.000Z");
  expect(onHand(counted, "rice")).toBe(4900);
  // Cooked at noon, after the reading: 4.9 kg − 200 g
  const afterCooking = cooked(counted, tuesday, "lunch", "m1", noon);
  expect(onHand(afterCooking, "rice")).toBe(4700);
  // A reading taken at 11:00 but arriving later still counts the noon meal
  expect(onHand(read(afterCooking, "rice", 5000, "2026-10-20T11:00:00.000Z"), "rice")).toBe(4800);
  // A reading older than the latest one changes nothing
  expect(onHand(read(counted, "rice", 1, "2026-10-20T09:00:00.000Z"), "rice")).toBe(4900);
});

test("unticking a meal cooked before the latest reading changes nothing: the reading already counts it", () => {
  const planned = { id: "m1", date: tuesday, slot: "lunch" as const, description: "rice", status: "planned" as const, recipeIds: ["rb"] };
  const afterCooking = cooked(kitchen({ meals: [planned] }), tuesday, "lunch", "m1", noon);
  const counted = read(afterCooking, "rice", 1000, "2026-10-20T13:00:00.000Z");
  expect(onHand(uncooked(counted, tuesday, "lunch"), "rice")).toBe(1000);
});

test("reminder times follow anchors from the meal's time", () => {
  // Beans: soak 13 h before lunch, take them out of the water 8 h after the soak
  const offsets = reminderOffsets([reminder("drain", 8 * 60, "soak"), reminder("soak", -13 * 60), reminder("prep", -45)]);
  expect(offsets).toEqual(new Map([["soak", -780], ["drain", -300], ["prep", -45]]));
  expect(reminderOffsets([reminder("a", 1, "a")])).toBeNull();
});

test("meal reminders ring for planned meals with recipes; not cancelled or cooked ones", () => {
  const beansRecipe = { ...riceAndBeans, reminders: [reminder("soak", -13 * 60), reminder("drain", 8 * 60, "soak")] };
  const meals = [
    { id: "l", date: tuesday, slot: "lunch" as const, description: "rice and beans", status: "planned" as const, recipeIds: ["rb"] },
    { id: "d", date: tuesday, slot: "dinner" as const, description: "rice and beans", status: "cancelled" as const, recipeIds: ["rb"] },
    { id: "b", date: tuesday, slot: "breakfast" as const, description: "rice and beans", status: "cooked" as const, recipeIds: ["rb"] },
  ];
  const from = new Date("2026-10-19T00:00:00");
  const rings = mealReminders(kitchen({ recipes: [beansRecipe], meals }), from, 2).map((ring) => `${ring.key} ${ring.at.toString().slice(0, 21)} ${ring.title}`);
  expect(rings).toEqual([
    "meal:2026-10-20:lunch:soak Tue Oct 20 2026 00:00 soak (lunch: Rice and beans)",
    "meal:2026-10-20:lunch:drain Tue Oct 20 2026 08:00 drain (lunch: Rice and beans)",
  ]);
});

// Shown while on its way: an item whose row already arrived live is not listed a second time
test("a stock item made while its row has already arrived is listed once", () => {
  const item: StockItem = { id: "rice", name: "Rice", unit: "kg", target: 2000, onHand: 1500, readAt: "2026-11-06T00:00:00.000Z" };
  const snapshot = { kitchen: { ...emptyKitchen, items: [item] } } as Snapshot;
  const delta = previewChange(snapshot, "createStockItem", [{ id: "rice", name: "Rice", unit: "kg", target: 2000 }], "2026-11-06T00:01:00.000Z");
  expect((delta.kitchen ?? snapshot.kitchen).items).toEqual([item]);
});
