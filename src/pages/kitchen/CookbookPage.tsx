import { useState, type ReactNode } from "react";
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
  const recipes = [...kitchen.recipes].sort((a, b) => a.title.localeCompare(b.title));
  const open = recipes.find((recipe) => recipe.id === recipeId) ?? null;

  const startNew = () => {
    onOpenRecipe(null);
    setDraft({
      recipe: { id: crypto.randomUUID(), title: "", body: "", ingredients: [], reminders: [{ id: crypto.randomUUID(), anchorId: null, ...DEFAULT_REMINDER }] },
      isNew: true,
    });
  };

  const detail = draft ? (
    <RecipeEditor
      key={draft.recipe.id}
      kitchen={kitchen}
      recipe={draft.recipe}
      onSave={async (recipe) => {
        // Kept open if the save failed, so nothing written is lost
        if (!(await act("saveRecipe", recipe, draft.isNew))) return;
        setDraft(null);
        onOpenRecipe(recipe.id);
      }}
      onCancel={() => setDraft(null)}
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
    <section className="panel-scroll flex min-h-0 flex-col gap-2 overflow-y-auto rounded-3xl border border-white/10 bg-night-panel p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.26em] text-white/55">Recipes</h2>
        <button type="button" onClick={startNew} className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/70 hover:text-emerald-100">
          + New recipe
        </button>
      </div>
      {recipes.length === 0 ? <p className="text-[11px] tracking-[0.1em] text-white/35">No recipes yet.</p> : null}
      {recipes.map((recipe) => (
        <button
          key={recipe.id}
          type="button"
          onClick={() => {
            setDraft(null);
            onOpenRecipe(recipe.id);
          }}
          className={`rounded-xl border px-3 py-2 text-left text-xs ${recipe.id === open?.id && !draft ? "border-white/24 bg-white/[0.06] text-white/90" : "border-white/8 bg-night/50 text-white/75 hover:border-white/18"}`}
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
          onClick={() => {
            setDraft(null);
            onOpenRecipe(null);
          }}
          className="self-start text-[10px] uppercase tracking-[0.18em] text-white/45"
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
          <section className="flex flex-1 items-center justify-center rounded-3xl border border-white/10 bg-night-panel text-[11px] tracking-[0.14em] text-white/35">
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
    <section className="panel-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto rounded-3xl border border-white/10 bg-night-panel p-5">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-sm uppercase tracking-[0.22em] text-white/85">{recipe.title}</h1>
        <div className="flex shrink-0 gap-2 text-[10px] uppercase tracking-[0.16em]">
          <button type="button" onClick={onEdit} className="rounded-md border border-white/10 px-2 py-1 text-white/70 hover:border-white/24">
            Edit
          </button>
          <button
            type="button"
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            className="rounded-md border border-red-400/30 px-2 py-1 text-red-200 hover:border-red-300/50"
          >
            {confirmDelete ? "Really delete?" : "Delete"}
          </button>
        </div>
      </div>

      <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/80">{recipe.body || <span className="text-white/30">No method written yet.</span>}</p>

      <Part title="Tracked ingredients">
        {recipe.ingredients.length === 0 ? <p className="text-[11px] text-white/35">None: cooking it deducts nothing.</p> : null}
        {recipe.ingredients.map((ingredient) => (
          <p key={ingredient.id} className="flex justify-between text-xs text-white/75">
            <span>
              {ingredient.name}
              {ingredient.itemId && kitchen.items.some((item) => item.id === ingredient.itemId) ? null : <span className="ml-2 text-[10px] text-amber-200/70">not in stocks</span>}
            </span>
            <span className="text-white/55">
              {round(fromBase(ingredient.amount, ingredient.unit))} {ingredient.unit}
            </span>
          </p>
        ))}
      </Part>

      <Part title="Reminders">
        {recipe.reminders.length === 0 ? <p className="text-[11px] text-white/35">None.</p> : null}
        {recipe.reminders.map((reminder) => (
          <p key={reminder.id} className="flex justify-between gap-3 text-xs text-white/75">
            <span>{reminder.label}</span>
            <span className="text-right text-white/50">{timing(reminder, recipe.reminders)}</span>
          </p>
        ))}
      </Part>
    </section>
  );
}

// Write or rewrite a recipe: its text, the ingredients it deducts, and the alarms it sets.
// Nothing is saved until Save, which refuses what recipeProblems finds.
function RecipeEditor({ kitchen, recipe, onSave, onCancel }: { kitchen: Kitchen; recipe: Recipe; onSave: (recipe: Recipe) => Promise<void>; onCancel: () => void }) {
  const [draft, setDraft] = useState(recipe);
  // Amounts as typed, in each ingredient's own unit, so a half-typed number is kept
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(recipe.ingredients.map((ingredient) => [ingredient.id, `${round(fromBase(ingredient.amount, ingredient.unit))}`])),
  );
  const [problems, setProblems] = useState<string[]>([]);
  const items = [...kitchen.items].sort((a, b) => a.name.localeCompare(b.name));

  const withAmounts = (): Recipe => ({
    ...draft,
    title: draft.title.trim(),
    ingredients: draft.ingredients.map((ingredient) => ({ ...ingredient, amount: toBase(Number(amounts[ingredient.id] ?? 0), ingredient.unit) })),
  });

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
      className="panel-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto rounded-3xl border border-white/10 bg-night-panel p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const recipe = withAmounts();
        const found = recipeProblems(recipe, kitchen.items);
        setProblems(found);
        if (found.length === 0) void onSave(recipe);
      }}
    >
      <input
        autoFocus
        value={draft.title}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        placeholder="Recipe name"
        aria-label="Recipe name"
        className="rounded-md border border-white/10 bg-night/70 px-2 py-1.5 text-sm text-white/90"
      />
      <textarea
        value={draft.body}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        placeholder="The method, step by step, as you want to read it"
        aria-label="Method"
        rows={10}
        className="min-h-40 rounded-md border border-white/10 bg-night/70 px-2 py-1.5 text-xs leading-relaxed text-white/85"
      />

      <Part title="Tracked ingredients" hint="Only these come off your stocks when a meal using the recipe is ticked.">
        {draft.ingredients.map((ingredient) => {
          const item = items.find((candidate) => candidate.id === ingredient.itemId);
          return (
            <div key={ingredient.id} className="flex flex-wrap items-center gap-2 text-xs">
              <select
                value={ingredient.itemId ?? ""}
                aria-label="Stock item"
                onChange={(event) => {
                  const chosen = items.find((candidate) => candidate.id === event.target.value)!;
                  setIngredient(ingredient.id, { itemId: chosen.id, name: chosen.name, unit: sameKind(chosen.unit, ingredient.unit) ? ingredient.unit : chosen.unit });
                }}
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-night/70 px-1.5 py-1 text-white/85"
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
                className="w-20 rounded-md border border-white/10 bg-night/70 px-1.5 py-1 text-right text-white/85"
              />
              <select
                value={ingredient.unit}
                aria-label={`${ingredient.name} unit`}
                onChange={(event) => setIngredient(ingredient.id, { unit: event.target.value as StockUnit })}
                className="rounded-md border border-white/10 bg-night/70 px-1.5 py-1 text-white/85"
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
          <p className="text-[11px] text-white/35">Track a staple under Stocks to deduct it here.</p>
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
        <ul className="space-y-1 rounded-xl border border-red-400/30 bg-red-500/[0.06] p-3 text-[11px] text-red-200">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex justify-end gap-2 text-[10px] uppercase tracking-[0.16em]">
        <button type="button" onClick={onCancel} className="px-2 py-1 text-white/45 hover:text-white/75">
          Cancel
        </button>
        <button type="submit" className="rounded-md border border-white/16 px-3 py-1 text-white/85 hover:border-white/30">
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
    <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
      <input
        value={reminder.label}
        onChange={(event) => onChange({ label: event.target.value })}
        placeholder="Soak the beans"
        aria-label="Reminder"
        className="min-w-0 flex-1 basis-40 rounded-md border border-white/10 bg-night/70 px-1.5 py-1 text-white/85"
      />
      <input
        type="number"
        min={0}
        value={round(minutes / 60)}
        step="any"
        aria-label={`${reminder.label || "Reminder"} hours`}
        onChange={(event) => onChange({ offsetMinutes: Math.round(Number(event.target.value) * 60) * (before ? -1 : 1) })}
        className="w-14 rounded-md border border-white/10 bg-night/70 px-1.5 py-1 text-right text-white/85"
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
        className="rounded-md border border-white/10 bg-night/70 px-1.5 py-1 text-white/85"
      >
        <option value="before">before</option>
        <option value="after">after</option>
      </select>
      <select
        value={reminder.anchorId ?? ""}
        aria-label={`${reminder.label || "Reminder"} timed from`}
        onChange={(event) => onChange({ anchorId: event.target.value || null })}
        className="max-w-40 rounded-md border border-white/10 bg-night/70 px-1.5 py-1 text-white/85"
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
      <h3 className="text-[10px] uppercase tracking-[0.22em] text-white/50">{title}</h3>
      {hint ? <p className="-mt-1 text-[10px] tracking-[0.06em] text-white/30">{hint}</p> : null}
      {children}
    </div>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/70 hover:text-emerald-100">
      {children}
    </button>
  );
}

function Remove({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Remove" className="px-1 text-white/35 hover:text-red-200">
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
