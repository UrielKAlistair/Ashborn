/**
 * The Kitchen's rules, shared by the screens, the offline previews, the alarm schedule and the agent
 * server.
 *
 * Stock is kept as readings plus events. A reading says how much of an item is on hand at a moment;
 * cooking a meal adds events (negative amounts) for its recipes' ingredients. On hand is the latest
 * reading plus the events made after it, so a count taken after cooking is never cooked down twice.
 * The database computes the same (stock_on_hand, cook_meal, uncook_meal); cooked, uncooked and read
 * here mirror it, so the app can show the result before the server answers, or offline.
 *
 * Meals: a date's slot shows its own meal, or else the default week's for that weekday. A recipe's
 * reminders ring relative to the meal's time, or to each other; mealReminders lists them for the
 * schedule. Recipe bodies may hold alternative routes ("[1: oven]", "[2: pan]"), read by recipeRoutes.
 */
import { addDays, atTime, toISODate, weekdayOf } from "./dates.js";
import {
  mealSlots,
  mealTimes,
  units,
  type ISODate,
  type Kitchen,
  type Meal,
  type MealSlot,
  type Recipe,
  type RecipeReminder,
  type StockChange,
  type StockItem,
  type StockUnit,
} from "./types.js";

export const emptyKitchen: Kitchen = { items: [], recipes: [], defaultWeek: [], meals: [], mealChanges: [] };

// A new recipe's one reminder, which the user may edit or delete
export const DEFAULT_REMINDER = { label: "Start prep", offsetMinutes: -45 };

// Rounded to a millionth of the base unit, so 0.29 kg is 290 g, not 290.00000000000006
export const toBase = (amount: number, unit: StockUnit) => Math.round(amount * units[unit].base * 1e6) / 1e6;
export const fromBase = (amount: number, unit: StockUnit) => amount / units[unit].base;
// An amount as shown, to a thousandth of its unit, so 4 g in a kg item reads 0.004 kg, not 0 kg
export const roundShown = (value: number) => Math.round(value * 1000) / 1000;
export const sameKind = (a: StockUnit, b: StockUnit) => units[a].kind === units[b].kind;
// One stock item per name: names compare without case or surrounding space ("Rice " and "rice" are one)
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// A shown meal: the date's own, or else the default week's for its weekday
export type ShownMeal = Meal & { fromDefault: boolean };

export function shownMeal(kitchen: Kitchen, date: ISODate, slot: MealSlot): ShownMeal {
  const own = kitchen.meals.find((meal) => meal.date === date && meal.slot === slot);
  if (own) return { ...own, fromDefault: false };
  const weekday = weekdayOf(date);
  const fallback = kitchen.defaultWeek.find((meal) => meal.weekday === weekday && meal.slot === slot);
  return { id: "", date, slot, description: fallback?.description ?? "", status: "planned", recipeIds: fallback?.recipeIds ?? [], fromDefault: true };
}

// What cooking a meal deducts (in base units, negative), and the ingredients it cannot deduct
// because their stock item was dropped
export function mealDeductions(kitchen: Kitchen, meal: Pick<Meal, "recipeIds">) {
  const changes: { itemId: string; amount: number }[] = [];
  const untracked: string[] = [];
  for (const recipe of kitchen.recipes.filter((candidate) => meal.recipeIds.includes(candidate.id))) {
    for (const ingredient of recipe.ingredients) {
      if (ingredient.itemId && kitchen.items.some((item) => item.id === ingredient.itemId)) changes.push({ itemId: ingredient.itemId, amount: -ingredient.amount });
      else untracked.push(ingredient.name);
    }
  }
  return { changes, untracked: untracked.sort() };
}

// Stock on hand is the latest reading plus the meal events made after it (as stock_on_hand computes
// it). A meal event made before the latest reading is already counted in that reading.
const after = (madeAt: string, readAt: string | null) => readAt === null || Date.parse(madeAt) > Date.parse(readAt);

// The Kitchen after cooking a meal at `at`: the meal cooked (copied from the default week if the date
// had none) and its events recorded, replacing any earlier ones. Mirrors cook_meal.
export function cooked(kitchen: Kitchen, date: ISODate, slot: MealSlot, id: string, at: string): Kitchen {
  const { fromDefault, ...shown } = shownMeal(kitchen, date, slot);
  const meal: Meal = { ...shown, id: fromDefault ? id : shown.id, status: "cooked" };
  const changes: StockChange[] = mealDeductions(kitchen, meal).changes.map((change, index) => ({ ...change, id: `${meal.id}:${index}`, mealId: meal.id, madeAt: at }));
  const restored = uncooked(kitchen, date, slot);
  const applied = withEvents({ ...restored, meals: [...restored.meals.filter((other) => other.id !== meal.id), meal] }, changes);
  return { ...applied, mealChanges: [...applied.mealChanges, ...changes] };
}

// The Kitchen after unticking a meal: exactly its events taken back. Mirrors uncook_meal.
export function uncooked(kitchen: Kitchen, date: ISODate, slot: MealSlot): Kitchen {
  const meal = kitchen.meals.find((candidate) => candidate.date === date && candidate.slot === slot && candidate.status === "cooked");
  if (!meal) return kitchen;
  const own = kitchen.mealChanges.filter((change) => change.mealId === meal.id);
  const reverted = withEvents(kitchen, own.map((change) => ({ ...change, amount: -change.amount })));
  return {
    ...reverted,
    meals: reverted.meals.map((candidate) => (candidate.id === meal.id ? { ...candidate, status: "planned" } : candidate)),
    mealChanges: kitchen.mealChanges.filter((change) => change.mealId !== meal.id),
  };
}

// The Kitchen after a reading of `amount` base units taken at `at`. A reading older than the item's
// latest changes nothing; otherwise on hand is the reading plus the meals cooked since.
export function read(kitchen: Kitchen, itemId: string, amount: number, at: string): Kitchen {
  return {
    ...kitchen,
    items: kitchen.items.map((item) => {
      if (item.id !== itemId || !after(at, item.readAt)) return item;
      const since = kitchen.mealChanges.filter((change) => change.itemId === itemId && after(change.madeAt, at));
      return { ...item, onHand: since.reduce((sum, change) => sum + change.amount, amount), readAt: at };
    }),
  };
}

// Adds meal events to the amounts on hand, each only if made after its item's latest reading
function withEvents(kitchen: Kitchen, changes: StockChange[]): Kitchen {
  return {
    ...kitchen,
    items: kitchen.items.map((item) => {
      const counted = changes.filter((change) => change.itemId === item.id && after(change.madeAt, item.readAt));
      return counted.length ? { ...item, onHand: counted.reduce((sum, change) => sum + change.amount, item.onHand) } : item;
    }),
  };
}

// A recipe body's routes. A line "[1: name]" starts text only route 1 shows, "[all]" returns to text
// every route shows; the name is optional and the first one given is kept. `text` is the body as one
// route reads it, markers removed; with no routes it is the whole body.
export type RecipeRoute = { key: string; name: string };
const routeMark = /^\s*\[(?:(\d+)(?::\s*(.*?))?|all)\]\s*$/i;
export function recipeRoutes(body: string): { routes: RecipeRoute[]; text: (route: string | null) => string } {
  const routes: RecipeRoute[] = [];
  const lines: { route: string | null; line: string }[] = [];
  let current: string | null = null;
  for (const line of body.split("\n")) {
    const mark = routeMark.exec(line);
    if (!mark) {
      lines.push({ route: current, line });
      continue;
    }
    current = mark[1] ?? null;
    const known = routes.find((route) => route.key === current);
    if (current && !known) routes.push({ key: current, name: mark[2] ?? "" });
    else if (known && !known.name) known.name = mark[2] ?? "";
  }
  routes.sort((a, b) => Number(a.key) - Number(b.key));
  const text = (route: string | null) =>
    lines
      .filter((line) => line.route === null || line.route === route)
      .map(({ line }) => line)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  return { routes, text };
}

// What is wrong with a recipe before it can be saved; empty when nothing is
export function recipeProblems(recipe: Recipe, items: StockItem[]): string[] {
  const problems: string[] = [];
  if (!recipe.title.trim()) problems.push("A recipe needs a title.");
  for (const ingredient of recipe.ingredients) {
    if (!(ingredient.amount > 0)) problems.push(`${ingredient.name}: the amount must be more than 0.`);
    const item = items.find((candidate) => candidate.id === ingredient.itemId);
    if (item && !sameKind(item.unit, ingredient.unit)) {
      problems.push(`${ingredient.name}: ${item.name} is counted in ${item.unit}, so ${ingredient.unit} cannot be used.`);
    }
  }
  const ids = new Set(recipe.reminders.map((reminder) => reminder.id));
  for (const reminder of recipe.reminders) {
    if (reminder.anchorId && !ids.has(reminder.anchorId)) problems.push(`${reminder.label}: it is timed from a reminder that is not in this recipe.`);
  }
  if (problems.length === 0 && reminderOffsets(recipe.reminders) === null) problems.push("The reminders are timed from each other in a loop.");
  return problems;
}

// Each reminder's total offset from the meal's time, following anchors; null if they loop
export function reminderOffsets(reminders: RecipeReminder[]): Map<string, number> | null {
  const byId = new Map(reminders.map((reminder) => [reminder.id, reminder]));
  const offsets = new Map<string, number>();
  for (const reminder of reminders) {
    const chain: RecipeReminder[] = [];
    let current: RecipeReminder | undefined = reminder;
    while (current && !offsets.has(current.id)) {
      if (chain.includes(current)) return null;
      chain.push(current);
      current = current.anchorId ? byId.get(current.anchorId) : undefined;
    }
    let base = current ? offsets.get(current.id)! : 0;
    for (const link of chain.reverse()) offsets.set(link.id, (base += link.offsetMinutes));
  }
  return offsets;
}

// One reminder ringing for one meal
export type MealReminder = { key: string; at: Date; title: string };

// The reminders of meals shown from the day before `from` over the next `days` days: the day
// before, since a reminder timed after last night's meal can ring after midnight; the caller drops
// rings already past. A cancelled or cooked meal rings nothing, nor does a meal with no recipe.
export function mealReminders(kitchen: Kitchen, from: Date, days: number): MealReminder[] {
  const reminders: MealReminder[] = [];
  for (let offset = -1; offset < days; offset++) {
    const date = addDays(toISODate(from), offset);
    for (const slot of mealSlots) {
      const meal = shownMeal(kitchen, date, slot);
      if (meal.status !== "planned") continue;
      const mealAt = atTime(date, mealTimes[slot]);
      for (const recipe of kitchen.recipes.filter((candidate) => meal.recipeIds.includes(candidate.id))) {
        const offsets = reminderOffsets(recipe.reminders) ?? new Map<string, number>();
        for (const reminder of recipe.reminders) {
          reminders.push({
            key: `meal:${date}:${slot}:${reminder.id}`,
            at: new Date(mealAt.getTime() + (offsets.get(reminder.id) ?? 0) * 60_000),
            title: `${reminder.label} (${slot}: ${recipe.title})`,
          });
        }
      }
    }
  }
  return reminders;
}
