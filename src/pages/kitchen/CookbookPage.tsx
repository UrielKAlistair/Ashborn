import { useEffect, useRef, useState, type ReactNode } from "react";
import { keepScreenAwake } from "../../lib/alarms";
import { readStored, writeStored } from "../../lib/storage";
import { askToLeave, holdUnsaved } from "../../lib/unsaved";
import { HexMark } from "../../components/HexTile";
import { RowMenu } from "../../components/RowMenu";
import { DEFAULT_REMINDER, fromBase, roundShown, recipeProblems, recipeRoutes, sameKind, toBase } from "../../shared/kitchen";
import { stockUnits, type Kitchen, type Recipe, type RecipeIngredient, type RecipeReminder, type StockUnit } from "../../shared/types";
import type { Act } from "../home/HomePage";

// A step: a bulleted line (•, -, *) or a numbered one (1. or 1))
const step = /^\s*([•\-*]|\d+[.)])\s/;
// The route last read of a recipe, kept on this device
const routeStorageKey = (recipeId: string) => `ashborn-recipe-route:${recipeId}`;
// Struck steps outlast leaving the recipe while the app runs, by recipe and route, until this long
// after the last strike, so a later cooking starts clean
const STRUCK_KEEP_MS = 6 * 3600_000;
const struckSteps = new Map<string, { keys: ReadonlySet<string>; at: number }>();

type CookbookProps = { kitchen: Kitchen; act: Act; phone: boolean; recipeId: string | null; onOpenRecipe: (id: string | null) => void };

/**
 * The Cookbook: the list of recipes, and the chosen one to read (RecipeView) or write (RecipeEditor).
 * The desktop shows the list and the recipe side by side; the phone shows one or the other, and Back
 * (or ‹ Recipes) returns to the list. An editor with changes holds them as unsaved work, so anything
 * that would leave it asks first (lib/unsaved.ts). While a recipe is read the phone's screen stays on.
 * A recipe body is free text; lines like "[1: oven]" split it into routes (shared/kitchen.ts
 * recipeRoutes), and bulleted or numbered lines are steps the cook can strike through.
 */
export function CookbookPage({ kitchen, act, phone, recipeId, onOpenRecipe }: CookbookProps) {
  // The recipe being written; `isNew` is fixed when writing starts, so saving an edit of a recipe
  // deleted elsewhere meanwhile is refused rather than recreating it
  const [draft, setDraft] = useState<{ recipe: Recipe; isNew: boolean } | null>(null);
  // Leaving the editor asks first when it holds changes (lib/unsaved.ts)
  const leaveEditor = (then: () => void) => void askToLeave().then((leave) => leave && then());
  const recipes = [...kitchen.recipes].sort((a, b) => a.title.localeCompare(b.title));
  const open = recipes.find((recipe) => recipe.id === recipeId) ?? null;

  const startNew = () =>
    leaveEditor(() => {
      onOpenRecipe(null);
      setDraft({
        recipe: { id: crypto.randomUUID(), title: "", body: "", ingredients: [], reminders: [{ id: crypto.randomUUID(), anchorId: null, ...DEFAULT_REMINDER }] },
        isNew: true,
      });
    });

  const detail = draft ? (
    <RecipeEditor
      key={draft.recipe.id}
      kitchen={kitchen}
      recipe={draft.recipe}
      // Kept open if the save failed, so nothing written is lost
      onSave={(recipe) => act("saveRecipe", recipe, draft.isNew)}
      onSaved={(id) => {
        setDraft(null);
        onOpenRecipe(id);
      }}
      onCancel={() => leaveEditor(() => setDraft(null))}
      onDiscard={() => setDraft(null)}
    />
  ) : open ? (
    <RecipeView
      key={open.id}
      kitchen={kitchen}
      recipe={open}
      onEdit={() => setDraft({ recipe: open, isNew: false })}
      onDelete={() => {
        void act("deleteRecipe", open.id);
        onOpenRecipe(null);
      }}
    />
  ) : null;

  const list = (
    <section className="panel-lift rounded-2xl border border-ink/8 bg-panel panel-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="caps font-display text-[13px] font-bold text-ink/85">Recipes</h2>
        <button type="button" onClick={startNew} className="rounded-lg px-1 text-[12.5px] font-medium text-ember hover:brightness-110 phone:min-h-11">
          + New recipe
        </button>
      </div>
      {recipes.length === 0 ? <p className="text-[12px] text-muted">No recipes yet.</p> : null}
      {recipes.map((recipe) => (
        <button
          key={recipe.id}
          type="button"
          onClick={() =>
            leaveEditor(() => {
              setDraft(null);
              onOpenRecipe(recipe.id);
            })
          }
          className={`rounded-xl border px-3 py-2.5 text-left shadow-[0_1px_0_rgb(110_84_40/0.14)] phone:min-h-11 ${recipe.id === open?.id && !draft ? "border-ember/40 bg-ember/10" : "border-ink/10 bg-card/70 hover:border-ink/25"}`}
        >
          <span className={`block font-display text-[17px] leading-tight ${recipe.id === open?.id && !draft ? "text-ember" : "text-ink/90"}`}>{recipe.title}</span>
          {recipe.ingredients.length > 0 ? <span className="mt-0.5 block truncate text-[11.5px] text-muted">{recipe.ingredients.map((ingredient) => ingredient.name).join(" · ")}</span> : null}
        </button>
      ))}
    </section>
  );

  // On the phone, a recipe (read or edited) goes back to the list, by ‹ Recipes or the phone's Back button
  const backToList = phone && detail
    ? () =>
        leaveEditor(() => {
          setDraft(null);
          onOpenRecipe(null);
        })
    : null;
  const latestBack = useRef(backToList);
  latestBack.current = backToList;
  const hasBack = backToList !== null;
  useEffect(() => {
    if (!hasBack) return;
    const back = () => {
      latestBack.current?.();
      return true;
    };
    window.ashbornBack = back;
    return () => {
      if (window.ashbornBack === back) delete window.ashbornBack;
    };
  }, [hasBack]);

  // The screen stays on while a recipe is read, so it doesn't lock mid-cooking
  const reading = open !== null && draft === null;
  useEffect(() => {
    if (!reading) return;
    keepScreenAwake(true);
    return () => keepScreenAwake(false);
  }, [reading]);

  if (phone) {
    return detail ? (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <button
          type="button"
          onClick={() => backToList?.()}
          className="self-start text-[13px] text-muted phone:min-h-11 phone:pr-3"
        >
          ‹ Recipes
        </button>
        {detail}
      </div>
    ) : (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{list}</div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-5">
      <div className="flex min-h-0 w-[30%] min-w-[16rem] max-w-[22rem] flex-col">{list}</div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {detail ?? (
          <section className="panel-lift rounded-2xl border border-ink/8 bg-panel flex flex-1 flex-col items-center justify-center gap-3 text-[13px] text-muted">
            <HexMark className="h-10 w-12 text-ink/15" />
            Choose a recipe, or write a new one.
          </section>
        )}
      </div>
    </div>
  );
}

// A recipe to cook from: its method, on the route chosen when it has several (the last one read is
// remembered on this device), then what it deducts and what reminders it sets. Edit and Delete are
// in its ⋯ menu; Delete asks once more.
function RecipeView({ kitchen, recipe, onEdit, onDelete }: { kitchen: Kitchen; recipe: Recipe; onEdit: () => void; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { routes, text } = recipeRoutes(recipe.body);
  // The route last read, kept on this device
  const [routeKey, setRouteKey] = useState(() => loadRoute(recipe.id) ?? routes[0]?.key ?? null);
  const route = routes.find((candidate) => candidate.key === routeKey) ?? routes[0] ?? null;
  const method = text(route?.key ?? null);

  return (
    <section className="panel-lift rounded-2xl border border-ink/8 bg-panel panel-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="font-display text-lg font-semibold text-ink/90">{recipe.title}</h1>
          {routes.length > 0 ? (
            <div role="tablist" aria-label="Route" className="flex gap-1">
              {routes.map((candidate) => (
                <button
                  key={candidate.key}
                  type="button"
                  role="tab"
                  aria-selected={candidate.key === route?.key}
                  title={candidate.name || undefined}
                  onClick={() => {
                    setRouteKey(candidate.key);
                    saveRoute(recipe.id, candidate.key);
                  }}
                  className={`h-7 min-w-7 rounded-md px-2 font-mono text-[12.5px] phone:h-11 phone:min-w-11 ${candidate.key === route?.key ? "bg-ember/15 text-ember" : "text-muted hover:bg-ink/6 hover:text-ink/85"}`}
                >
                  {candidate.key}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {confirmDelete ? (
            <>
              <button type="button" onClick={onDelete} className="rounded-lg border border-red-400/25 px-2.5 py-1 text-[12px] text-red-300 hover:bg-red-400/10 phone:min-h-11">
                Really delete?
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg px-2 py-1 text-[12px] text-muted hover:text-ink/85 phone:min-h-11">
                Keep
              </button>
            </>
          ) : null}
          <RowMenu
            title={recipe.title}
            items={[
              { label: "Edit", onClick: onEdit },
              { label: "Delete", onClick: () => setConfirmDelete(true) },
            ]}
          />
        </div>
      </div>

      {route?.name ? <p className="-mt-3 text-[12.5px] text-muted">{route.name}</p> : null}
      <Method key={route?.key ?? ""} text={method} marks={`${recipe.id}:${route?.key ?? ""}`} />

      <Part title="Tracked ingredients">
        {recipe.ingredients.length === 0 ? <p className="text-[12px] text-muted">None: cooking it deducts nothing.</p> : null}
        {recipe.ingredients.map((ingredient) => (
          <p key={ingredient.id} className="flex justify-between gap-3 text-[13px] text-ink/75">
            <span>
              {ingredient.name}
              {ingredient.itemId && kitchen.items.some((item) => item.id === ingredient.itemId) ? null : <span className="ml-2 text-[11px] text-amber-200">not in stocks</span>}
            </span>
            <span className="font-mono tabular-nums text-muted">
              {roundShown(fromBase(ingredient.amount, ingredient.unit))} {ingredient.unit}
            </span>
          </p>
        ))}
      </Part>

      <Part title="Reminders">
        {recipe.reminders.length === 0 ? <p className="text-[12px] text-muted">None.</p> : null}
        {recipe.reminders.map((reminder) => (
          <p key={reminder.id} className="flex justify-between gap-3 text-[13px] text-ink/75">
            <span>{reminder.label}</span>
            <span className="text-right text-[12px] text-muted">{timing(reminder, recipe.reminders)}</span>
          </p>
        ))}
      </Part>
    </section>
  );
}

// A recipe's method, a line at a time: a blank line parts sections, a section's first line reads as its
// heading when steps follow it, and a step's wrapped text lines up with its first line. A tap on a step strikes it through
// while cooking; the marks are kept by recipe and route while the app runs (struckSteps), not saved.
function Method({ text, marks }: { text: string; marks: string }) {
  const [struck, setStruck] = useState<ReadonlySet<string>>(() => {
    const kept = struckSteps.get(marks);
    return kept && Date.now() - kept.at < STRUCK_KEEP_MS ? kept.keys : new Set();
  });
  if (!text) return <p className="text-sm text-ink/30">No method written yet.</p>;
  const strike = (key: string) => {
    const next = new Set(struck);
    if (!next.delete(key)) next.add(key);
    struckSteps.set(marks, { keys: next, at: Date.now() });
    setStruck(next);
  };

  return (
    <div role="group" aria-label="Method" className="space-y-4 text-sm leading-relaxed text-ink/80">
      {text.split(/\n\s*\n/).map((section, index) => (
        <div key={index} className="space-y-1.5">
          {section.split("\n").map((line, at, lines) => {
            if (!step.test(line)) {
              // A section's first line reads as its heading when steps follow it; any other line is prose
              const heading = at === 0 && lines.slice(1).some((next) => step.test(next));
              return (
                <p key={at} className={`whitespace-pre-wrap ${heading ? "font-medium text-ink/90" : ""}`}>
                  {line}
                </p>
              );
            }
            const key = `${index}:${at}:${line}`;
            const done = struck.has(key);
            return (
              <p
                key={at}
                role="checkbox"
                aria-checked={done}
                tabIndex={0}
                onClick={() => strike(key)}
                onKeyDown={(event) => {
                  if (event.key !== " " && event.key !== "Enter") return;
                  event.preventDefault();
                  strike(key);
                }}
                className={`cursor-pointer whitespace-pre-wrap rounded-md pl-[2ch] -indent-[2ch] transition-colors focus-visible:outline focus-visible:outline-ember/60 ${done ? "text-ink/35 line-through" : "hover:text-ink/95"}`}
              >
                {line}
              </p>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Write or rewrite a recipe: its text, the ingredients it deducts, and the alarms it sets.
// Nothing is saved until Save, which refuses what recipeProblems finds. While anything differs from
// the recipe as it opened, the edit is held as unsaved (lib/unsaved.ts), so leaving asks first.
type RecipeEditorProps = {
  kitchen: Kitchen;
  recipe: Recipe;
  onSave: (recipe: Recipe) => Promise<boolean>;
  onSaved: (id: string) => void; // after a save, to leave the editor
  onCancel: () => void;
  onDiscard: () => void;
};
function RecipeEditor({ kitchen, recipe, onSave, onSaved, onCancel, onDiscard }: RecipeEditorProps) {
  const [draft, setDraft] = useState(recipe);
  // Amounts as typed, in each ingredient's own unit, so a half-typed number is kept
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(recipe.ingredients.map((ingredient) => [ingredient.id, `${roundShown(fromBase(ingredient.amount, ingredient.unit))}`])),
  );
  // The amounts and units as they opened: an amount left as it was, in the same unit, keeps its exact
  // value, not the rounded one shown. A changed unit (chosen, or a stock item of another kind chosen)
  // reads the amount again as typed, in the new unit.
  const [opened] = useState(amounts);
  const [openedUnits] = useState(() => new Map(recipe.ingredients.map((ingredient) => [ingredient.id, ingredient.unit])));
  const [problems, setProblems] = useState<string[]>([]);
  const items = [...kitchen.items].sort((a, b) => a.name.localeCompare(b.name));

  const withAmounts = (): Recipe => ({
    ...draft,
    title: draft.title.trim(),
    ingredients: draft.ingredients.map((ingredient) =>
      amounts[ingredient.id] === opened[ingredient.id] && ingredient.unit === openedUnits.get(ingredient.id)
        ? ingredient
        : { ...ingredient, amount: toBase(Number(amounts[ingredient.id] ?? 0), ingredient.unit) },
    ),
  });

  // Saves if recipeProblems finds nothing; true once saved. The work stays held as unsaved until the
  // save has gone through, so leaving meanwhile still asks; then the hold is let go and the editor left.
  // One save at a time.
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return false;
    const edited = withAmounts();
    const found = recipeProblems(edited, kitchen.items);
    setProblems(found);
    if (found.length > 0) return false;
    setSaving(true);
    const saved = await onSave(edited).finally(() => setSaving(false));
    if (saved) {
      release.current?.();
      onSaved(edited.id);
    }
    return saved;
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(recipe) || Object.entries(amounts).some(([id, amount]) => amount !== opened[id]);
  const latestSave = useRef(save);
  latestSave.current = save;
  const release = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!changed) return;
    release.current = holdUnsaved({ what: "changes to this recipe", save: () => latestSave.current(), discard: onDiscard });
    return release.current;
  }, [changed]);

  const setIngredient = (id: string, patch: Partial<RecipeIngredient>) =>
    setDraft({ ...draft, ingredients: draft.ingredients.map((ingredient) => (ingredient.id === id ? { ...ingredient, ...patch } : ingredient)) });
  const setReminder = (id: string, patch: Partial<RecipeReminder>) =>
    setDraft({ ...draft, reminders: draft.reminders.map((reminder) => (reminder.id === id ? { ...reminder, ...patch } : reminder)) });

  const addIngredient = () => {
    const item = items[0];
    if (!item) return;
    const unit = recipeUnit(item.unit);
    setDraft({ ...draft, ingredients: [...draft.ingredients, { id: crypto.randomUUID(), itemId: item.id, name: item.name, amount: 0, unit }] });
  };

  return (
    <form
      className="panel-lift rounded-2xl border border-ink/8 bg-panel panel-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5"
      // Escape anywhere in the editor cancels (asking first when it holds changes); marked handled so the
      // navbar doesn't also hide the window
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        autoFocus
        value={draft.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        placeholder="Recipe name"
        aria-label="Recipe name"
        className="rounded-lg border border-ink/10 bg-canvas/60 px-2.5 py-1.5 font-display text-base font-semibold text-ink/90 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none"
      />
      <textarea
        value={draft.body}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        placeholder="The method, step by step, as you want to read it"
        aria-label="Method"
        rows={10}
        className="min-h-40 [field-sizing:content] rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-2.5 py-2 leading-relaxed"
      />
      <p className="-mt-3 text-[11.5px] text-muted">
        Cooked more than one way? A line <code className="font-mono">[1: name]</code> starts what only route 1 shows, and <code className="font-mono">[all]</code> goes back to
        what every route shows. A line starting with •, - or * and a space, or a number and a dot or bracket (1. or 1) ), is a step.
      </p>

      <Part title="Tracked ingredients" hint="Only these come off your stocks when a meal using the recipe is ticked.">
        {draft.ingredients.map((ingredient) => {
          const item = items.find((candidate) => candidate.id === ingredient.itemId);
          return (
            <div key={ingredient.id} className="flex flex-wrap items-center gap-2">
              <select
                value={ingredient.itemId ?? ""}
                aria-label="Stock item"
                onChange={(event) => {
                  const chosen = items.find((candidate) => candidate.id === event.target.value)!;
                  setIngredient(ingredient.id, { itemId: chosen.id, name: chosen.name, unit: sameKind(chosen.unit, ingredient.unit) ? ingredient.unit : recipeUnit(chosen.unit) });
                }}
                className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-1"
              >
                {item ? null : <option value="">{ingredient.name} (not in stocks)</option>}
                {items.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step="any"
                value={amounts[ingredient.id] ?? ""}
                aria-label={`${ingredient.name} amount`}
                onChange={(event) => setAmounts({ ...amounts, [ingredient.id]: event.target.value })}
                className="w-20 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-1 text-right font-mono tabular-nums"
              />
              <select
                value={ingredient.unit}
                aria-label={`${ingredient.name} unit`}
                onChange={(event) => {
                  // The amount follows the unit (500 g becomes 0.5 kg), so it means what it meant
                  const unit = event.target.value as StockUnit;
                  const typed = Number(amounts[ingredient.id]);
                  if (amounts[ingredient.id]?.trim() && Number.isFinite(typed)) setAmounts({ ...amounts, [ingredient.id]: `${Number(fromBase(toBase(typed, ingredient.unit), unit).toFixed(6))}` });
                  setIngredient(ingredient.id, { unit });
                }}
                className="rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-1"
              >
                {stockUnits.filter((unit) => !item || sameKind(unit, item.unit)).map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
              <Remove onClick={() => setDraft({ ...draft, ingredients: draft.ingredients.filter((other) => other.id !== ingredient.id) })} />
            </div>
          );
        })}
        {items.length > 0 ? (
          <AddButton onClick={addIngredient}>+ Ingredient</AddButton>
        ) : (
          <p className="text-[12px] text-muted">Track a staple under Stocks to deduct it here.</p>
        )}
      </Part>

      <Part title="Reminders" hint="Alarms this recipe sets on the phone for each planned meal that uses it.">
        {draft.reminders.map((reminder) => (
          <ReminderRow
            key={reminder.id}
            reminder={reminder}
            others={draft.reminders.filter((other) => other.id !== reminder.id)}
            onChange={(patch) => setReminder(reminder.id, patch)}
            onRemove={() =>
              setDraft({
                ...draft,
                reminders: draft.reminders.filter((other) => other.id !== reminder.id).map((other) => (other.anchorId === reminder.id ? { ...other, anchorId: null } : other)),
              })
            }
          />
        ))}
        <AddButton onClick={() => setDraft({ ...draft, reminders: [...draft.reminders, { id: crypto.randomUUID(), label: "", offsetMinutes: -60, anchorId: null }] })}>
          + Reminder
        </AddButton>
      </Part>

      {problems.length > 0 ? (
        <ul className="space-y-1 rounded-xl bg-red-400/10 p-3 text-[12px] text-red-300">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-2.5 py-1 text-[12px] text-muted hover:text-ink/85 phone:min-h-11">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="rounded-lg bg-ember px-3 py-1 text-[12px] font-medium text-canvas hover:brightness-110 disabled:opacity-40 phone:min-h-11 phone:px-4">
          Save
        </button>
      </div>
    </form>
  );
}

// A reminder: its label, and how long before or after the meal (or another reminder) it rings
function ReminderRow({ reminder, others, onChange, onRemove }: { reminder: RecipeReminder; others: RecipeReminder[]; onChange: (patch: Partial<RecipeReminder>) => void; onRemove: () => void }) {
  // Kept apart from the offset's sign, which a zero (a cleared field) loses
  const [before, setBefore] = useState(reminder.offsetMinutes <= 0);
  const minutes = Math.abs(reminder.offsetMinutes);

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink/60">
      <input
        value={reminder.label}
        onChange={(event) => onChange({ label: event.target.value })}
        placeholder="Soak the beans"
        aria-label="Reminder"
        className="min-w-0 flex-1 basis-40 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-1"
      />
      <input
        type="number"
        min={0}
        value={inHours(minutes)}
        step="any"
        aria-label={`${reminder.label || "Reminder"} hours`}
        onChange={(event) => onChange({ offsetMinutes: Math.round(Math.abs(Number(event.target.value)) * 60) * (before ? -1 : 1) })}
        className="w-14 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-1 text-right font-mono tabular-nums"
      />
      h
      <select
        value={before ? "before" : "after"}
        aria-label={`${reminder.label || "Reminder"} before or after`}
        onChange={(event) => {
          const nowBefore = event.target.value === "before";
          setBefore(nowBefore);
          onChange({ offsetMinutes: minutes * (nowBefore ? -1 : 1) });
        }}
        className="rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-1"
      >
        <option value="before">before</option>
        <option value="after">after</option>
      </select>
      <select
        value={reminder.anchorId ?? ""}
        aria-label={`${reminder.label || "Reminder"} timed from`}
        onChange={(event) => onChange({ anchorId: event.target.value || null })}
        className="max-w-40 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-1"
      >
        <option value="">the meal</option>
        {others.map((other) => (
          <option key={other.id} value={other.id}>
            {other.label || "another reminder"}
          </option>
        ))}
      </select>
      <Remove onClick={onRemove} />
    </div>
  );
}

function Part({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="caps font-display text-[11px] font-semibold text-ink/65">{title}</h3>
      {hint ? <p className="-mt-1 text-[11.5px] text-muted">{hint}</p> : null}
      {children}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className="rounded-lg px-1 text-[12.5px] font-medium text-ember hover:brightness-110 phone:min-h-11">
      {children}
    </button>
  );
}

function Remove({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Remove" className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-ink/8 hover:text-red-300 phone:h-11 phone:w-11">
      ×
    </button>
  );
}

function loadRoute(recipeId: string) {
  return readStored<string | null>(routeStorageKey(recipeId), null);
}

function saveRoute(recipeId: string, route: string) {
  writeStored(routeStorageKey(recipeId), route);
}

// "45 min before the meal", "8 h after Soak the beans"
function timing(reminder: RecipeReminder, reminders: RecipeReminder[]) {
  const minutes = Math.abs(reminder.offsetMinutes);
  const span = minutes >= 60 ? `${inHours(minutes)} h` : `${minutes} min`;
  const anchor = reminder.anchorId ? reminders.find((other) => other.id === reminder.anchorId)?.label || "another reminder" : "the meal";
  return `${span} ${reminder.offsetMinutes < 0 ? "before" : "after"} ${anchor}`;
}

// Minutes as hours, to a hundredth
function inHours(minutes: number) {
  return Math.round((minutes / 60) * 100) / 100;
}

// The unit a recipe writes an item's amount in: grams and millilitres, which recipes use, for an item
// kept in kilos or litres
function recipeUnit(unit: StockUnit): StockUnit {
  return unit === "kg" ? "g" : unit === "l" ? "ml" : unit;
}
