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
    <section className="panel-lift rounded-2xl border border-ink/8 bg-panel flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="caps font-display text-[13px] font-bold text-ink/85">{defaults ? "Default week" : "Meal plan"}</h2>
        <button
          type="button"
          role="switch"
          aria-checked={defaults}
          onClick={() => setDefaults(!defaults)}
          className={`rounded-lg border px-2.5 py-1 text-[12px] font-medium max-sm:min-h-11 max-sm:px-3.5 ${defaults ? "border-ember/40 bg-ember/10 text-ember" : "border-ink/12 text-ink/60 hover:bg-ink/6"}`}
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
    <div ref={strip} className="flex min-h-0 flex-1 snap-x py-px snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
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
      className={`panel-scroll flex min-h-0 w-full flex-col gap-1.5 overflow-y-auto rounded-xl p-2 ${offset === 0 ? "bg-ember/[0.06] ring-1 ring-ember/30" : "bg-ink/[0.015]"} ${offset < 0 ? "opacity-60" : ""}`}
    >
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 px-1 pb-0.5">
        <span className={`font-display text-[13px] font-semibold ${offset === 0 ? "text-ember" : "text-ink/85"}`}>{name}</span>
        <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted">{day.slice(5)}</span>
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
    <div role="group" aria-label={`${meal.slot} on ${meal.date}`} className={`group relative rounded-lg px-2.5 py-2 ${empty ? "border border-dashed border-ink/8" : "bg-ink/[0.035] hover:bg-ink/[0.055]"} ${cooked ? "opacity-55" : ""}`}>
      <div className="flex items-center gap-2">
        {empty || cancelled ? null : <Tick done={cooked} onClick={tick} />}
        <p className="min-w-0 flex-1 text-[11.5px] capitalize text-muted">
          {meal.slot} <span className="whitespace-nowrap font-mono text-[10.5px] tabular-nums text-ink/35">{mealTimes[meal.slot]}</span>
        </p>
        {/* Over the slot's name until hovered on the desktop, where a day's column has no room for both */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-2 rounded-md bg-card px-1.5 py-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-sm:static max-sm:gap-0 max-sm:bg-transparent max-sm:p-0 max-sm:opacity-100">
        {!cooked && !empty ? (
          <button
            type="button"
            onClick={() => void act("setMeal", { id: id(), date: meal.date, slot: meal.slot, description: meal.description, recipeIds: meal.recipeIds, status: cancelled ? "planned" : "cancelled" })}
            className="text-[11.5px] text-muted hover:text-ink/85 max-sm:min-h-11 max-sm:px-2"
            title={cancelled ? "Bring this meal back" : "Cancel this meal and its alarms"}
          >
            {cancelled ? "Restore" : "Cancel"}
          </button>
        ) : null}
        {!cooked ? (
          <button type="button" onClick={() => setEditing(true)} className="text-[11.5px] text-muted hover:text-ink/85 max-sm:min-h-11 max-sm:px-2" title="Change this meal">
            Edit
          </button>
        ) : null}
        </div>
      </div>

      <p className={`mt-1 text-[13px] leading-snug ${cancelled ? "text-ink/35 line-through" : "text-ink/85"} ${meal.fromDefault ? "italic" : ""}`}>
        {meal.description || (empty ? <span className="text-ink/30 not-italic">Nothing planned</span> : null)}
      </p>
      <RecipeLinks kitchen={kitchen} recipeIds={meal.recipeIds} onOpenRecipe={onOpenRecipe} />

      {untracked.length > 0 ? (
        <button
          type="button"
          onClick={() => setUntracked([])}
          className="mt-2 w-full rounded-lg bg-amber-300/10 px-2 py-1.5 text-left text-[11.5px] leading-snug text-amber-200"
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
          className="rounded-md bg-ink/8 px-1.5 py-0.5 text-[11px] text-ink/75 hover:bg-ink/12 max-sm:px-2 max-sm:py-1"
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
      className="space-y-2 rounded-xl border border-ink/10 bg-card p-2.5 shadow-[var(--card-shadow)]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text.trim(), chosen);
      }}
    >
      <p className="text-[11.5px] capitalize text-muted">{slot}</p>
      <input
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        placeholder="Rice with butter beans"
        aria-label={`${slot} description`}
        className="w-full rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-2 py-1"
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
                className={`rounded-md border px-1.5 py-0.5 text-[11px] max-sm:px-2 max-sm:py-1 ${on ? "border-ember/50 bg-ember/15 text-ember" : "border-ink/10 text-muted hover:bg-ink/6"}`}
              >
                {recipe.title}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-[12px] text-muted hover:text-ink/85 max-sm:min-h-11 max-sm:px-2">
          Cancel
        </button>
        <button type="submit" className="rounded-lg bg-ember px-3 py-1 text-[12px] font-medium text-canvas hover:brightness-110 disabled:opacity-40 max-sm:min-h-11 max-sm:px-4">
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
          <div aria-label={`Default meals on ${weekday}`} className="panel-scroll flex min-h-0 w-full flex-col gap-1.5 overflow-y-auto rounded-xl bg-ink/[0.015] p-2">
            <p className="caps px-1 pb-0.5 font-display text-[11px] font-semibold text-ink/70">{weekday}</p>
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
    <div role="group" aria-label={`Default ${slot} on ${weekday}`} className="rounded-lg bg-ink/[0.035] px-2.5 py-2 hover:bg-ink/[0.055]">
      <div className="flex items-center justify-between">
        <p className="text-[11.5px] capitalize text-muted">{slot}</p>
        <button type="button" onClick={() => setEditing(true)} className="text-[11.5px] text-muted hover:text-ink/85 max-sm:min-h-11 max-sm:px-2">
          Edit
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-ink/85">{meal?.description || <span className="text-ink/30">Nothing</span>}</p>
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
      className="flex w-7 shrink-0 items-center justify-center rounded-lg text-lg text-muted hover:bg-ink/6 hover:text-ink/85 disabled:opacity-20"
    >
      {children}
    </button>
  );
}
