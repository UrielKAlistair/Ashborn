import { useEffect, useRef, useState } from "react";
import { useToday } from "../../lib/useToday";
import { addDays, daysBetween, week, weekdayOf } from "../../shared/dates";
import { mealDeductions, shownMeal, type ShownMeal } from "../../shared/kitchen";
import { mealDaysAhead, mealDaysBack, mealSlots, mealTimes, type ISODate, type Kitchen, type MealSlot, type Weekday } from "../../shared/types";
import type { Act } from "../home/HomePage";
import { Tick } from "../home/Tick";

// Days the desktop shows at once, today in the middle
const DESKTOP_DAYS = 5;

type MealPlanProps = { kitchen: Kitchen; dayStartHour: number; act: Act; phone: boolean; onOpenRecipe: (id: string) => void };

// The days' meals, rolling with today: 2 days back to 6 ahead. The desktop shows five days and
// shifts with arrows; the phone shows one day per card, swiped sideways. A toggle swaps in the
// default week, which fills any day not planned.
export function MealPlan({ kitchen, dayStartHour, act, phone, onOpenRecipe }: MealPlanProps) {
  const [defaults, setDefaults] = useState(false);
  const date = useToday(dayStartHour);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-3xl border border-white/10 bg-night-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] uppercase tracking-[0.26em] text-white/55">{defaults ? "Default week" : "Meal plan"}</h2>
        <button
          type="button"
          role="switch"
          aria-checked={defaults}
          onClick={() => setDefaults(!defaults)}
          className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.18em] ${defaults ? "border-white/30 bg-white/10 text-white/85" : "border-white/10 text-white/45 hover:border-white/24"}`}
        >
          Default week
        </button>
      </div>

      {defaults ? (
        <DefaultWeek kitchen={kitchen} act={act} phone={phone} onOpenRecipe={onOpenRecipe} />
      ) : phone ? (
        <PhoneDays kitchen={kitchen} act={act} date={date} onOpenRecipe={onOpenRecipe} />
      ) : (
        <DesktopDays kitchen={kitchen} act={act} date={date} onOpenRecipe={onOpenRecipe} />
      )}
    </section>
  );
}

type DaysProps = { kitchen: Kitchen; act: Act; date: ISODate; onOpenRecipe: (id: string) => void };

function DesktopDays({ kitchen, act, date, onOpenRecipe }: DaysProps) {
  // The first day shown, in days from today
  const [first, setFirst] = useState(-mealDaysBack);
  const last = mealDaysAhead - DESKTOP_DAYS + 1;
  const days = Array.from({ length: DESKTOP_DAYS }, (_, index) => addDays(date, first + index));

  return (
    <div className="flex min-h-0 flex-1 gap-2">
      <Arrow label="Earlier days" disabled={first <= -mealDaysBack} onClick={() => setFirst(first - 1)}>
        ‹
      </Arrow>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-5 gap-2">
        {days.map((day) => (
          <Day key={day} kitchen={kitchen} act={act} day={day} today={date} onOpenRecipe={onOpenRecipe} />
        ))}
      </div>
      <Arrow label="Later days" disabled={first >= last} onClick={() => setFirst(first + 1)}>
        ›
      </Arrow>
    </div>
  );
}

function PhoneDays({ kitchen, act, date, onOpenRecipe }: DaysProps) {
  const strip = useRef<HTMLDivElement>(null);
  const days = Array.from({ length: mealDaysBack + mealDaysAhead + 1 }, (_, index) => addDays(date, index - mealDaysBack));

  // Open on today's card
  useEffect(() => {
    const element = strip.current;
    if (element) element.scrollLeft = mealDaysBack * element.clientWidth;
  }, []);

  return (
    <div ref={strip} className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
      {days.map((day) => (
        <div key={day} className="flex w-full shrink-0 snap-center px-0.5">
          <Day kitchen={kitchen} act={act} day={day} today={date} onOpenRecipe={onOpenRecipe} />
        </div>
      ))}
    </div>
  );
}

function Day({ kitchen, act, day, today: date, onOpenRecipe }: { kitchen: Kitchen; act: Act; day: ISODate; today: ISODate; onOpenRecipe: (id: string) => void }) {
  const offset = daysBetween(date, day);
  const name = offset === 0 ? "Today" : offset === -1 ? "Yesterday" : offset === 1 ? "Tomorrow" : weekdayOf(day);

  return (
    <div
      aria-label={`Meals on ${day}`}
      className={`panel-scroll flex min-h-0 w-full flex-col gap-2 overflow-y-auto rounded-2xl border p-2.5 ${offset === 0 ? "border-white/24 bg-white/[0.04]" : "border-white/8"} ${offset < 0 ? "opacity-70" : ""}`}
    >
      <p className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-white/55">
        <span>{name}</span>
        <span className="tracking-[0.1em] text-white/35">{day.slice(5)}</span>
      </p>
      {mealSlots.map((slot) => (
        <MealCell key={slot} kitchen={kitchen} act={act} meal={shownMeal(kitchen, day, slot)} onOpenRecipe={onOpenRecipe} />
      ))}
    </div>
  );
}

// One meal: tick when cooked (deducting its recipes' tracked ingredients), cancel ahead of time
// (silencing its alarms), or edit what it is
function MealCell({ kitchen, act, meal, onOpenRecipe }: { kitchen: Kitchen; act: Act; meal: ShownMeal; onOpenRecipe: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [untracked, setUntracked] = useState<string[]>([]);
  const cooked = meal.status === "cooked";
  const cancelled = meal.status === "cancelled";
  const empty = !meal.description && meal.recipeIds.length === 0;
  const id = () => meal.id || crypto.randomUUID();

  const tick = () => {
    if (cooked) return void act("uncookMeal", meal.date, meal.slot);
    setUntracked(mealDeductions(kitchen, meal).untracked);
    void act("cookMeal", meal.date, meal.slot, id());
  };

  if (editing) {
    return (
      <MealEditor
        kitchen={kitchen}
        slot={meal.slot}
        description={meal.description}
        recipeIds={meal.recipeIds}
        onSave={(description, recipeIds) => {
          void act("setMeal", { id: id(), date: meal.date, slot: meal.slot, description, recipeIds, status: "planned" });
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div role="group" aria-label={`${meal.slot} on ${meal.date}`} className={`rounded-xl border border-white/8 bg-night/50 px-2.5 py-2 ${cooked ? "opacity-55" : ""}`}>
      <div className="flex items-center gap-2">
        {empty || cancelled ? <span className="h-4 w-4 shrink-0" /> : <Tick done={cooked} onClick={tick} />}
        <p className="min-w-0 flex-1 text-[10px] uppercase tracking-[0.18em] text-white/45">
          {meal.slot} <span className="tracking-[0.08em] text-white/30">{mealTimes[meal.slot]}</span>
        </p>
        {!cooked && !empty ? (
          <button
            type="button"
            onClick={() => void act("setMeal", { id: id(), date: meal.date, slot: meal.slot, description: meal.description, recipeIds: meal.recipeIds, status: cancelled ? "planned" : "cancelled" })}
            className="text-[10px] text-white/35 hover:text-white/75"
            title={cancelled ? "Bring this meal back" : "Cancel this meal and its alarms"}
          >
            {cancelled ? "Restore" : "Cancel"}
          </button>
        ) : null}
        {!cooked ? (
          <button type="button" onClick={() => setEditing(true)} className="text-[10px] text-white/35 hover:text-white/75" title="Change this meal">
            Edit
          </button>
        ) : null}
      </div>

      <p className={`mt-1 text-xs leading-snug ${cancelled ? "text-white/35 line-through" : "text-white/85"} ${meal.fromDefault ? "italic" : ""}`}>
        {meal.description || (empty ? <span className="text-white/30 not-italic">Nothing planned</span> : null)}
      </p>
      <RecipeLinks kitchen={kitchen} recipeIds={meal.recipeIds} onOpenRecipe={onOpenRecipe} />

      {untracked.length > 0 ? (
        <button
          type="button"
          onClick={() => setUntracked([])}
          className="mt-2 w-full rounded-lg border border-amber-300/30 bg-amber-300/[0.06] px-2 py-1 text-left text-[10px] leading-snug text-amber-100/85"
        >
          Not in your stocks, so not deducted: {untracked.join(", ")} ×
        </button>
      ) : null}
    </div>
  );
}

function RecipeLinks({ kitchen, recipeIds, onOpenRecipe }: { kitchen: Kitchen; recipeIds: string[]; onOpenRecipe: (id: string) => void }) {
  const recipes = kitchen.recipes.filter((recipe) => recipeIds.includes(recipe.id));
  if (recipes.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {recipes.map((recipe) => (
        <button
          key={recipe.id}
          type="button"
          onClick={() => onOpenRecipe(recipe.id)}
          className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-sky-200/80 hover:border-white/24"
        >
          {recipe.title}
        </button>
      ))}
    </div>
  );
}

function MealEditor({
  kitchen,
  slot,
  description,
  recipeIds,
  onSave,
  onCancel,
}: {
  kitchen: Kitchen;
  slot: MealSlot;
  description: string;
  recipeIds: string[];
  onSave: (description: string, recipeIds: string[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(description);
  const [chosen, setChosen] = useState(recipeIds);
  const recipes = [...kitchen.recipes].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <form
      className="space-y-2 rounded-xl border border-white/16 bg-night/70 p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text.trim(), chosen);
      }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">{slot}</p>
      <input
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        placeholder="Rice with butter beans"
        aria-label={`${slot} description`}
        className="w-full rounded-md border border-white/10 bg-night/70 px-2 py-1 text-xs text-white/85"
      />
      {recipes.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {recipes.map((recipe) => {
            const on = chosen.includes(recipe.id);
            return (
              <button
                key={recipe.id}
                type="button"
                aria-pressed={on}
                onClick={() => setChosen(on ? chosen.filter((other) => other !== recipe.id) : [...chosen, recipe.id])}
                className={`rounded-md border px-1.5 py-0.5 text-[10px] ${on ? "border-sky-300/40 bg-sky-300/10 text-sky-100" : "border-white/10 text-white/50"}`}
              >
                {recipe.title}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex justify-end gap-2 text-[10px] uppercase tracking-[0.16em]">
        <button type="button" onClick={onCancel} className="text-white/40 hover:text-white/70">
          Cancel
        </button>
        <button type="submit" className="rounded-md border border-white/10 px-2 py-0.5 text-white/75 hover:border-white/24">
          Save
        </button>
      </div>
    </form>
  );
}

// The week any unplanned day falls back to, weekday by weekday
function DefaultWeek({ kitchen, act, phone, onOpenRecipe }: { kitchen: Kitchen; act: Act; phone: boolean; onOpenRecipe: (id: string) => void }) {
  return (
    <div className={phone ? "flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]" : "grid min-h-0 flex-1 grid-cols-7 gap-2"}>
      {week.map((weekday) => (
        <div key={weekday} className={phone ? "flex w-full shrink-0 snap-center px-0.5" : "flex min-h-0"}>
          <div aria-label={`Default meals on ${weekday}`} className="panel-scroll flex min-h-0 w-full flex-col gap-2 overflow-y-auto rounded-2xl border border-white/8 p-2.5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/55">{weekday}</p>
            {mealSlots.map((slot) => (
              <DefaultCell key={slot} kitchen={kitchen} act={act} weekday={weekday} slot={slot} onOpenRecipe={onOpenRecipe} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DefaultCell({ kitchen, act, weekday, slot, onOpenRecipe }: { kitchen: Kitchen; act: Act; weekday: Weekday; slot: MealSlot; onOpenRecipe: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const meal = kitchen.defaultWeek.find((candidate) => candidate.weekday === weekday && candidate.slot === slot);

  if (editing) {
    return (
      <MealEditor
        kitchen={kitchen}
        slot={slot}
        description={meal?.description ?? ""}
        recipeIds={meal?.recipeIds ?? []}
        onSave={(description, recipeIds) => {
          void act("setDefaultMeal", { weekday, slot, description, recipeIds });
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div role="group" aria-label={`Default ${slot} on ${weekday}`} className="rounded-xl border border-white/8 bg-night/50 px-2.5 py-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">{slot}</p>
        <button type="button" onClick={() => setEditing(true)} className="text-[10px] text-white/35 hover:text-white/75">
          Edit
        </button>
      </div>
      <p className="mt-1 text-xs leading-snug text-white/85">{meal?.description || <span className="text-white/30">Nothing</span>}</p>
      <RecipeLinks kitchen={kitchen} recipeIds={meal?.recipeIds ?? []} onOpenRecipe={onOpenRecipe} />
    </div>
  );
}

function Arrow({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex w-6 shrink-0 items-center justify-center rounded-xl text-lg text-white/45 hover:bg-white/6 hover:text-white/80 disabled:opacity-20"
    >
      {children}
    </button>
  );
}
