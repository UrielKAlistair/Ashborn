import { useEffect, useRef, useState } from "react";
import { useToday } from "../../lib/useToday";
import { addDays, daysBetween, showTime, week, weekdayOf } from "../../shared/dates";
import { mealDeductions, shownMeal, type ShownMeal } from "../../shared/kitchen";
import { mealDaysAhead, mealDaysBack, mealSlots, mealTimes, type ISODate, type Kitchen, type MealSlot, type Weekday } from "../../shared/types";
import type { Act } from "../home/HomePage";
import { Tick } from "../home/Tick";

// Days the desktop shows at once, today in the middle
const DESKTOP_DAYS = 5;

type MealPlanProps = { kitchen: Kitchen; act: Act; phone: boolean; onOpenRecipe: (id: string) => void };

/**
 * The meal plan: each day's breakfast, lunch and dinner, rolling with today, from mealDaysBack days
 * back to mealDaysAhead ahead (the days the app holds). The desktop shows five days and shifts with
 * arrows; the phone shows one day per card, swiped sideways. A meal is ticked when cooked, which
 * takes its recipes' ingredients off the stocks; cancelled, which silences its reminders; or edited
 * (which plans a cancelled meal again, design 273). A switch swaps in the default week, which fills any day not planned.
 */
export function MealPlan({ kitchen, act, phone, onOpenRecipe }: MealPlanProps) {
  const [defaults, setDefaults] = useState(false);
  const date = useToday();

  return (
    <section className="panel-lift rounded-2xl border border-ink/8 bg-panel flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="caps font-display text-[13px] font-bold text-ink/85">{defaults ? "Default week" : "Meal plan"}</h2>
        <button
          type="button"
          role="switch"
          aria-checked={defaults}
          onClick={() => setDefaults(!defaults)}
          className={`rounded-lg border px-2.5 py-1 text-[12px] font-medium phone:min-h-11 phone:px-3.5 ${defaults ? "border-ember/40 bg-ember/10 text-ember" : "border-ink/12 text-ink/60 hover:bg-ink/6"}`}
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

  // Open on today's card, and go back to it when the day turns (the strip then starts a day later)
  useEffect(() => {
    const element = strip.current;
    if (element) element.scrollLeft = mealDaysBack * element.clientWidth;
  }, [date]);

  // Swipe from card `index` one card earlier (-1) or later (1), as a header's neighbour names do. Focus
  // follows to the new card's neighbour on the same side, so it stays on screen.
  const step = (index: number, by: -1 | 1) => {
    const element = strip.current!;
    element.scrollTo({ left: (index + by) * element.clientWidth, behavior: "smooth" });
    const neighbours = element.children[index + by].querySelectorAll<HTMLButtonElement>("button[data-side]");
    const same = [...neighbours].find((button) => button.dataset.side === (by < 0 ? "earlier" : "later"));
    (same ?? neighbours[0])?.focus({ preventScroll: true });
  };

  return (
    <div ref={strip} className="flex min-h-0 flex-1 snap-x py-px snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
      {days.map((day, index) => (
        // A day's card is as tall as its meals, up to the strip's height, rather than stretched to it
        <div key={day} className="flex w-full shrink-0 snap-center items-start px-0.5">
          <Day
            kitchen={kitchen}
            act={act}
            day={day}
            today={date}
            onOpenRecipe={onOpenRecipe}
            neighbours={{ earlier: index > 0 ? () => step(index, -1) : undefined, later: index < days.length - 1 ? () => step(index, 1) : undefined }}
          />
        </div>
      ))}
    </div>
  );
}

function dayName(day: ISODate, today: ISODate): string {
  const offset = daysBetween(today, day);
  return offset === 0 ? "Today" : offset === -1 ? "Yesterday" : offset === 1 ? "Tomorrow" : weekdayOf(day);
}

// The phone's card names the days either side in its header, each a press that swipes to it
type Neighbours = { earlier?: () => void; later?: () => void };

function Day({ kitchen, act, day, today: date, onOpenRecipe, neighbours }: { kitchen: Kitchen; act: Act; day: ISODate; today: ISODate; onOpenRecipe: (id: string) => void; neighbours?: Neighbours }) {
  const offset = daysBetween(date, day);
  const title = (
    <>
      <span className={`font-display text-[13px] font-semibold ${offset === 0 ? "text-ember" : "text-ink/85"}`}>{dayName(day, date)}</span>
      <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted">{day.slice(5)}</span>
    </>
  );

  return (
    <div
      aria-label={`Meals on ${day}`}
      className={`panel-scroll flex max-h-full min-h-0 w-full flex-col gap-1.5 overflow-y-auto rounded-xl p-2 ${offset === 0 ? "bg-ember/[0.06] ring-1 ring-ember/30" : "bg-ink/[0.015]"} ${offset < 0 ? "opacity-70" : ""}`}
    >
      {neighbours ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-x-2 px-1 pb-0.5">
          <Neighbour label={dayName(addDays(day, -1), date)} side="earlier" onClick={neighbours.earlier} />
          <p className="flex items-baseline gap-2">{title}</p>
          <Neighbour label={dayName(addDays(day, 1), date)} side="later" onClick={neighbours.later} />
        </div>
      ) : (
        <p className="flex flex-wrap items-baseline justify-between gap-x-2 px-1 pb-0.5">{title}</p>
      )}
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
  // A dish named the same as its one recipe is said once, by the recipe's link
  const linked = kitchen.recipes.filter((recipe) => meal.recipeIds.includes(recipe.id));
  const saysRecipe = linked.length === 1 && linked[0].title.trim().toLowerCase() === meal.description.trim().toLowerCase();
  const id = () => meal.id || crypto.randomUUID();

  const tick = () => {
    if (cooked) {
      setUntracked([]);
      return void act("uncookMeal", meal.date, meal.slot);
    }
    setUntracked(mealDeductions(kitchen, meal).untracked);
    // A cook refused deducted nothing, so the note about what it couldn't deduct goes too
    void act("cookMeal", meal.date, meal.slot, id()).then((saved) => saved || setUntracked([]));
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
    <div
      role="group"
      aria-label={`${meal.slot} on ${meal.date}`}
      // An empty slot is only its name; a press anywhere on it plans it
      onClick={empty ? () => setEditing(true) : undefined}
      className={`group relative rounded-lg px-2.5 py-2 ${empty ? "cursor-pointer border border-dashed border-ink/8 hover:border-ink/20" : "bg-ink/[0.035] hover:bg-ink/[0.055]"} ${cooked ? "opacity-55" : ""}`}
    >
      <div className="flex items-center gap-2">
        {empty || cancelled ? null : <Tick done={cooked} onClick={tick} />}
        <p className="min-w-0 flex-1 text-[11.5px] capitalize text-muted">
          {meal.slot} <span className="block whitespace-nowrap font-mono phone:inline text-[10.5px] tabular-nums text-ink/35">{showTime(mealTimes[meal.slot])}</span>
        </p>
        {/* Over the slot's name until hovered on the desktop, where a day's column has no room for both */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-2 rounded-md bg-card px-1.5 py-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 phone:static phone:gap-0 phone:bg-transparent phone:p-0 phone:opacity-100">
        {!cooked && !empty ? (
          <button
            type="button"
            onClick={() => void act("setMeal", { id: id(), date: meal.date, slot: meal.slot, description: meal.description, recipeIds: meal.recipeIds, status: cancelled ? "planned" : "cancelled" })}
            className="text-[11.5px] text-muted hover:text-ink/85 phone:min-h-11 phone:px-2"
            title={cancelled ? "Bring this meal back" : "Cancel this meal and its alarms"}
          >
            {cancelled ? "Restore" : "Cancel"}
          </button>
        ) : null}
        {!cooked ? (
          <button type="button" onClick={() => setEditing(true)} className="text-[11.5px] text-muted hover:text-ink/85 phone:min-h-11 phone:px-2" title="Change this meal">
            Edit
          </button>
        ) : null}
        </div>
      </div>

      {meal.description && !saysRecipe ? (
        <p className={`mt-1 text-[13px] leading-snug ${cancelled ? "text-ink/35 line-through" : "text-ink/85"} ${meal.fromDefault ? "italic" : ""}`}>{meal.description}</p>
      ) : null}
      <RecipeLinks kitchen={kitchen} recipeIds={meal.recipeIds} onOpenRecipe={onOpenRecipe} asTitle={saysRecipe} />

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

// The meal's recipes as links; one standing for the dish's name reads at the name's size
function RecipeLinks({ kitchen, recipeIds, onOpenRecipe, asTitle = false }: { kitchen: Kitchen; recipeIds: string[]; onOpenRecipe: (id: string) => void; asTitle?: boolean }) {
  const recipes = kitchen.recipes.filter((recipe) => recipeIds.includes(recipe.id));
  if (recipes.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {recipes.map((recipe) => (
        <button
          key={recipe.id}
          type="button"
          onClick={() => onOpenRecipe(recipe.id)}
          className={`relative before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${
            asTitle
              ? "text-left text-[13px] leading-snug text-ink/85 underline decoration-ink/25 underline-offset-4 hover:decoration-ember"
              : "rounded-md bg-ink/8 px-1.5 py-0.5 text-[11px] text-ink/75 hover:bg-ink/12 phone:px-2 phone:py-1"
          }`}
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
      // Escape anywhere in the editor cancels; marked handled so the navbar doesn't also hide the window
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      }}
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
                className={`rounded-md border px-1.5 py-0.5 text-[11px] phone:px-2 phone:py-1 relative before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${on ? "border-ember/50 bg-ember/15 text-ember" : "border-ink/10 text-muted hover:bg-ink/6"}`}
              >
                {recipe.title}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-[12px] text-muted hover:text-ink/85 phone:min-h-11 phone:px-2">
          Cancel
        </button>
        <button type="submit" className="rounded-lg bg-ember px-3 py-1 text-[12px] font-medium text-canvas hover:brightness-110 disabled:opacity-40 phone:min-h-11 phone:px-4">
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
        <button type="button" onClick={() => setEditing(true)} className="text-[11.5px] text-muted hover:text-ink/85 phone:min-h-11 phone:px-2">
          Edit
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-snug text-ink/85">{meal?.description || <span className="text-ink/30">Nothing</span>}</p>
      <RecipeLinks kitchen={kitchen} recipeIds={meal?.recipeIds ?? []} onOpenRecipe={onOpenRecipe} />
    </div>
  );
}

// A neighbouring day's name, quiet, with its tap area stretched to the header's height; none past the strip's ends
function Neighbour({ label, side, onClick }: { label: string; side: "earlier" | "later"; onClick?: () => void }) {
  if (!onClick) return <span />;

  return (
    <button
      type="button"
      onClick={onClick}
      data-side={side}
      aria-label={`Show ${label}`}
      className={`relative whitespace-nowrap text-[11.5px] text-ink/40 before:absolute before:-inset-y-2 before:-inset-x-1 before:content-[''] hover:text-ink/70 ${side === "earlier" ? "justify-self-start" : "justify-self-end"}`}
    >
      {side === "earlier" ? `‹ ${label}` : `${label} ›`}
    </button>
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
