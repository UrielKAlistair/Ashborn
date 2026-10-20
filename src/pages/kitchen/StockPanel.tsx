import { useState } from "react";
import { fromBase, toBase } from "../../shared/kitchen";
import { stockUnits, type Kitchen, type StockItem, type StockUnit } from "../../shared/types";
import type { Act } from "../home/HomePage";

// A bar turns amber below this share of its target, and red below the next
const AMBER_BELOW = 0.3;
const RED_BELOW = 0.1;
// Stock above the target shows as a red tip past the bar's end, never longer than this share of it
const OVERFLOW_TIP_MAX = 0.05;

// The kitchen's stores: one bar per tracked staple, and a form to start tracking another
export function StockPanel({ kitchen, act }: { kitchen: Kitchen; act: Act }) {
  const items = [...kitchen.items].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="panel-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-3xl border border-white/10 bg-night-panel p-4">
      <h2 className="text-[11px] uppercase tracking-[0.26em] text-white/55">Stocks</h2>
      {items.length === 0 ? <p className="text-[11px] tracking-[0.1em] text-white/35">Track a staple below and its bar shows here.</p> : null}
      {items.map((item) => (
        <StockBar key={item.id} item={item} act={act} />
      ))}
      <NewItemForm act={act} />
    </section>
  );
}

function StockBar({ item, act }: { item: StockItem; act: Act }) {
  const [editing, setEditing] = useState(false);
  const share = item.target > 0 ? item.onHand / item.target : 0;
  const fill = share >= AMBER_BELOW ? "bg-emerald-300/80" : share >= RED_BELOW ? "bg-amber-300/85" : "bg-red-400/85";
  const tip = Math.min(Math.max(share - 1, 0), OVERFLOW_TIP_MAX);

  return (
    <div role="group" aria-label={item.name} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-xs text-white/85">{item.name}</p>
        <button type="button" onClick={() => setEditing(!editing)} className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-white/40 hover:text-white/75">
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {/* The track leaves room at its end for the overflow tip */}
      <div className="relative h-2.5" style={{ width: `${100 / (1 + OVERFLOW_TIP_MAX)}%` }} role="meter" aria-label={`${item.name} stock`} aria-valuenow={item.onHand} aria-valuemin={0} aria-valuemax={item.target}>
        <div className="absolute inset-0 overflow-hidden rounded-full border border-white/8 bg-night/50">
          <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(share, 1) * 100}%` }} />
        </div>
        {tip > 0 ? <div className="absolute top-0 left-full h-full rounded-r-full bg-red-400/85" style={{ width: `${tip * 100}%` }} title="More than you usually keep" /> : null}
      </div>

      <p className="text-right text-[10px] tracking-[0.12em] text-white/45">
        {shown(item.onHand, item.unit)} / {shown(item.target, item.unit)}
      </p>

      {editing ? <StockEditor item={item} act={act} /> : null}
    </div>
  );
}

// A slider and a number field, linked, for restocking or correcting by hand; the amount is saved
// as a reading when the user lets go
function StockEditor({ item, act }: { item: StockItem; act: Act }) {
  const [draft, setDraft] = useState(fromBase(item.onHand, item.unit));
  // The number field as typed while it is edited, so a cleared field is not read as 0
  const [typed, setTyped] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const max = Math.max(fromBase(item.target, item.unit) * 1.5, draft);
  const step = item.unit === "kg" || item.unit === "l" ? 0.05 : 1;

  const save = () => {
    const amount = toBase(draft, item.unit);
    if (Number.isFinite(amount) && Math.abs(amount - item.onHand) > 1e-9) void act("setStock", crypto.randomUUID(), item.id, amount);
  };

  return (
    <div className="space-y-2 rounded-xl border border-white/8 bg-night/50 p-2.5">
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={0}
          max={max}
          step={step}
          value={draft}
          aria-label={`${item.name} amount`}
          onChange={(event) => {
            setTyped(null);
            setDraft(Number(event.target.value));
          }}
          onPointerUp={save}
          onKeyUp={save}
          className="min-w-0 flex-1 accent-emerald-300"
        />
        <input
          type="number"
          min={0}
          step="any"
          value={typed ?? round(draft)}
          aria-label={`${item.name} amount in ${item.unit}`}
          onChange={(event) => {
            setTyped(event.target.value);
            if (event.target.value.trim() !== "") setDraft(Number(event.target.value));
          }}
          onBlur={() => {
            if (typed === null || typed.trim() !== "") save();
            setTyped(null);
          }}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          className="w-16 rounded-md border border-white/10 bg-night/70 px-1.5 py-0.5 text-right text-xs text-white/85"
        />
        <span className="text-[10px] text-white/45">{item.unit}</span>
      </div>

      <div className="flex items-center justify-between gap-2 text-[10px] tracking-[0.1em] text-white/45">
        <label className="flex items-center gap-1.5">
          Keep
          <input
            type="number"
            min={0}
            step="any"
            defaultValue={round(fromBase(item.target, item.unit))}
            aria-label={`${item.name} target in ${item.unit}`}
            onBlur={(event) => {
              const target = toBase(Number(event.target.value), item.unit);
              if (target > 0 && target !== item.target) void act("updateStockItem", item.id, { target });
            }}
            className="w-14 rounded-md border border-white/10 bg-night/70 px-1.5 py-0.5 text-right text-xs text-white/85"
          />
          {item.unit}
        </label>
        <button
          type="button"
          onClick={() => (confirmDelete ? void act("deleteStockItem", item.id) : setConfirmDelete(true))}
          className="rounded-md border border-red-400/30 px-2 py-0.5 text-red-200 hover:border-red-300/50"
        >
          {confirmDelete ? "Stop tracking?" : "Stop tracking"}
        </button>
      </div>
    </div>
  );
}

function NewItemForm({ act }: { act: Act }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<StockUnit>("kg");
  const [target, setTarget] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-[10px] uppercase tracking-[0.18em] text-emerald-200/70 hover:text-emerald-100">
        + Track a staple
      </button>
    );
  }

  const valid = name.trim() !== "" && Number(target) > 0;
  const submit = () => {
    if (!valid) return;
    void act("createStockItem", { id: crypto.randomUUID(), name: name.trim(), unit, target: toBase(Number(target), unit) });
    setName("");
    setTarget("");
    setOpen(false);
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-night/50 p-2.5 text-xs"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input autoFocus placeholder="Rice" value={name} onChange={(event) => setName(event.target.value)} aria-label="Staple" className="min-w-0 flex-1 rounded-md border border-white/10 bg-night/70 px-2 py-1 text-white/85" />
      <input type="number" min={0} step="any" placeholder="Keep" value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Amount to keep" className="w-16 rounded-md border border-white/10 bg-night/70 px-2 py-1 text-right text-white/85" />
      <select value={unit} onChange={(event) => setUnit(event.target.value as StockUnit)} aria-label="Unit" className="rounded-md border border-white/10 bg-night/70 px-1.5 py-1 text-white/85">
        {stockUnits.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!valid} className="rounded-md border border-white/10 px-2 py-1 text-white/75 hover:border-white/24 disabled:opacity-40">
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-1 text-white/40 hover:text-white/70">
        ×
      </button>
    </form>
  );
}

// An amount in base units, written in the item's unit: "5 kg", "2 count" as "2"
function shown(amount: number, unit: StockUnit) {
  const value = round(fromBase(amount, unit));
  return unit === "count" ? `${value}` : `${value} ${unit}`;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
