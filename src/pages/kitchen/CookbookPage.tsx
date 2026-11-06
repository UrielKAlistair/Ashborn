import { useEffect, useRef, useState, type ReactNode } from "react";
import { askToLeave, holdUnsaved } from "../../lib/unsaved";
import { HexMark } from "../../components/HexTile";
import { DEFAULT_REMINDER, fromBase, recipeProblems, sameKind, toBase } from "../../shared/kitchen";
import { stockUnits, type Kitchen, type Recipe, type RecipeIngredient, type RecipeReminder, type StockUnit } from "../../shared/types";
import type { Act } from "../home/HomePage";

type CookbookProps = { kitchen: Kitchen; act: Act; phone: boolean; recipeId: string | null; onOpenRecipe: (id: string | null) => void };

// The recipes: a list, and the chosen one to read or edit. The desktop shows both side by side;
// the phone shows the list, or one recipe.
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
      onSave={async (recipe) => {
        // Kept open if the save failed, so nothing written is lost
        if (!(await act("saveRecipe", recipe, draft.isNew))) return false;
        setDraft(null);
        onOpenRecipe(recipe.id);
        return true;
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
          className={`rounded-lg px-3 py-2 text-left text-[13px] phone:min-h-11 ${recipe.id === open?.id && !draft ? "bg-ember/10 text-ember" : "bg-ink/[0.03] text-ink/80 hover:bg-ink/[0.055]"}`}
        >
          {recipe.title}
        </button>
      ))}
    </section>
  );

  if (phone) {
    return detail ? (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <button
          type="button"
          onClick={() =>
            leaveEditor(() => {
              setDraft(null);
              onOpenRecipe(null);
            })
          }
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

function RecipeView({ kitchen, recipe, onEdit, onDelete }: { kitchen: Kitchen; recipe: Recipe; onEdit: () => void; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <section className="panel-lift rounded-2xl border border-ink/8 bg-panel panel-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-lg font-semibold text-ink/90">{recipe.title}</h1>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onEdit} className="rounded-lg border border-ink/12 px-2.5 py-1 text-[12px] text-ink/75 hover:bg-ink/6 phone:min-h-11 phone:px-3.5">
            Edit
          </button>
          <button
            type="button"
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            className="rounded-lg border border-red-400/25 px-2.5 py-1 text-[12px] text-red-300 hover:bg-red-400/10 phone:min-h-11"
          >
            {confirmDelete ? "Really delete?" : "Delete"}
          </button>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/80">{recipe.body || <span className="text-ink/30">No method written yet.</span>}</p>

      <Part title="Tracked ingredients">
        {recipe.ingredients.length === 0 ? <p className="text-[12px] text-muted">None: cooking it deducts nothing.</p> : null}
        {recipe.ingredients.map((ingredient) => (
          <p key={ingredient.id} className="flex justify-between gap-3 text-[13px] text-ink/75">
            <span>
              {ingredient.name}
              {ingredient.itemId && kitchen.items.some((item) => item.id === ingredient.itemId) ? null : <span className="ml-2 text-[11px] text-amber-200">not in stocks</span>}
            </span>
            <span className="font-mono tabular-nums text-muted">
              {round(fromBase(ingredient.amount, ingredient.unit))} {ingredient.unit}
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

// Write or rewrite a recipe: its text, the ingredients it deducts, and the alarms it sets.
// Nothing is saved until Save, which refuses what recipeProblems finds. While anything differs from
// the recipe as it opened, the edit is held as unsaved (lib/unsaved.ts), so leaving asks first.
type RecipeEditorProps = { kitchen: Kitchen; recipe: Recipe; onSave: (recipe: Recipe) => Promise<boolean>; onCancel: () => void; onDiscard: () => void };
function RecipeEditor({ kitchen, recipe, onSave, onCancel, onDiscard }: RecipeEditorProps) {
  const [draft, setDraft] = useState(recipe);
  // Amounts as typed, in each ingredient's own unit, so a half-typed number is kept
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(recipe.ingredients.map((ingredient) => [ingredient.id, `${round(fromBase(ingredient.amount, ingredient.unit))}`])),
  );
  // The amounts as they opened: one left as it was keeps its exact value, not the rounded one shown
  const [opened] = useState(amounts);
  const [problems, setProblems] = useState<string[]>([]);
  const items = [...kitchen.items].sort((a, b) => a.name.localeCompare(b.name));

  const withAmounts = (): Recipe => ({
    ...draft,
    title: draft.title.trim(),
    ingredients: draft.ingredients.map((ingredient) =>
      amounts[ingredient.id] === opened[ingredient.id] ? ingredient : { ...ingredient, amount: toBase(Number(amounts[ingredient.id] ?? 0), ingredient.unit) },
    ),
  });

  // Saves if recipeProblems finds nothing; true once saved. The hold is let go first, since the save
  // leaves the editor (and may navigate), and taken again if the save fails.
  const save = async () => {
    const edited = withAmounts();
    const found = recipeProblems(edited, kitchen.items);
    setProblems(found);
    if (found.length > 0) return false;
    release.current?.();
    const saved = await onSave(edited);
    if (!saved) setHoldAgain((count) => count + 1);
    return saved;
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(recipe) || Object.entries(amounts).some(([id, amount]) => amount !== opened[id]);
  const latestSave = useRef(save);
  latestSave.current = save;
  const release = useRef<(() => void) | null>(null);
  const [holdAgain, setHoldAgain] = useState(0);
  useEffect(() => {
    if (!changed) return;
    release.current = holdUnsaved({ what: "changes to this recipe", save: () => latestSave.current(), discard: onDiscard });
    return release.current;
  }, [changed, holdAgain]);

  const setIngredient = (id: string, patch: Partial<RecipeIngredient>) =>
    setDraft({ ...draft, ingredients: draft.ingredients.map((ingredient) => (ingredient.id === id ? { ...ingredient, ...patch } : ingredient)) });
  const setReminder = (id: string, patch: Partial<RecipeReminder>) =>
    setDraft({ ...draft, reminders: draft.reminders.map((reminder) => (reminder.id === id ? { ...reminder, ...patch } : reminder)) });

  const addIngredient = () => {
    const item = items[0];
    if (!item) return;
    const unit: StockUnit = item.unit === "kg" ? "g" : item.unit === "l" ? "ml" : item.unit;
    setDraft({ ...draft, ingredients: [...draft.ingredients, { id: crypto.randomUUID(), itemId: item.id, name: item.name, amount: 0, unit }] });
  };

  return (
    <form
      className="panel-lift rounded-2xl border border-ink/8 bg-panel panel-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5"
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
        className="min-h-40 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-2.5 py-2 leading-relaxed"
      />

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
                  setIngredient(ingredient.id, { itemId: chosen.id, name: chosen.name, unit: sameKind(chosen.unit, ingredient.unit) ? ingredient.unit : chosen.unit });
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
        <button type="submit" className="rounded-lg bg-ember px-3 py-1 text-[12px] font-medium text-canvas hover:brightness-110 disabled:opacity-40 phone:min-h-11 phone:px-4">
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
        value={round(minutes / 60)}
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

// "45 min before the meal", "8 h after Soak the beans"
function timing(reminder: RecipeReminder, reminders: RecipeReminder[]) {
  const minutes = Math.abs(reminder.offsetMinutes);
  const span = minutes >= 60 ? `${round(minutes / 60)} h` : `${minutes} min`;
  const anchor = reminder.anchorId ? reminders.find((other) => other.id === reminder.anchorId)?.label || "another reminder" : "the meal";
  return `${span} ${reminder.offsetMinutes < 0 ? "before" : "after"} ${anchor}`;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
