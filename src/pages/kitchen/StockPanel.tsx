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
    <section className="panel-lift rounded-2xl border border-white/8 bg-night-panel panel-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <h2 className="font-display text-sm font-semibold text-white/85">Stocks</h2>
      {items.length === 0 ? <p className="text-[12px] text-white/40">Track a staple below and its bar shows here.</p> : null}
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
        <p className="truncate text-[13px] text-white/85">{item.name}</p>
        <button type="button" onClick={() => setEditing(!editing)} className="shrink-0 text-[11.5px] text-white/40 hover:text-white/85 max-sm:min-h-11 max-sm:px-2">
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      {/* The track leaves room at its end for the overflow tip */}
      <div className="relative h-2" style={{ width: `${100 / (1 + OVERFLOW_TIP_MAX)}%` }} role="meter" aria-label={`${item.name} stock`} aria-valuenow={item.onHand} aria-valuemin={0} aria-valuemax={item.target}>
        <div className="absolute inset-0 overflow-hidden rounded-full bg-white/[0.07]">
          <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.min(share, 1) * 100}%` }} />
        </div>
        {tip > 0 ? <div className="absolute top-0 left-full h-full rounded-r-full bg-red-400/85" style={{ width: `${tip * 100}%` }} title="More than you usually keep" /> : null}
      </div>

      <p className="text-right font-mono text-[11px] tabular-nums text-white/45">
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
    <div className="space-y-2 rounded-xl bg-white/[0.03] p-2.5">
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
          className="min-w-0 flex-1 accent-ember"
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
          className="w-16 rounded-lg border border-white/10 bg-night/60 text-[13px] text-white/85 placeholder:text-white/30 focus:border-ember/60 focus:outline-none px-1.5 py-0.5 text-right font-mono tabular-nums"
        />
        <span className="text-[11.5px] text-white/45">{item.unit}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-white/45">
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
            className="w-14 rounded-lg border border-white/10 bg-night/60 text-[13px] text-white/85 placeholder:text-white/30 focus:border-ember/60 focus:outline-none px-1.5 py-0.5 text-right font-mono tabular-nums"
          />
          {item.unit}
        </label>
        <button
          type="button"
          onClick={() => (confirmDelete ? void act("deleteStockItem", item.id) : setConfirmDelete(true))}
          className="rounded-lg border border-red-400/25 px-2.5 py-1 text-[12px] text-red-300 hover:bg-red-400/10 max-sm:min-h-11"
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
      <button type="button" onClick={() => setOpen(true)} className="self-start rounded-lg px-1 text-[12.5px] font-medium text-ember hover:brightness-110 max-sm:min-h-11">
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
      className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.03] p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input autoFocus placeholder="Rice" value={name} onChange={(event) => setName(event.target.value)} aria-label="Staple" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-night/60 text-[13px] text-white/85 placeholder:text-white/30 focus:border-ember/60 focus:outline-none px-2 py-1" />
      <input type="number" min={0} step="any" placeholder="Keep" value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Amount to keep" className="w-16 rounded-lg border border-white/10 bg-night/60 text-[13px] text-white/85 placeholder:text-white/30 focus:border-ember/60 focus:outline-none px-2 py-1 text-right font-mono tabular-nums" />
      <select value={unit} onChange={(event) => setUnit(event.target.value as StockUnit)} aria-label="Unit" className="rounded-lg border border-white/10 bg-night/60 text-[13px] text-white/85 placeholder:text-white/30 focus:border-ember/60 focus:outline-none px-1.5 py-1">
        {stockUnits.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!valid} className="rounded-lg bg-ember px-3 py-1 text-[12px] font-medium text-night hover:brightness-110 disabled:opacity-40 max-sm:min-h-11 max-sm:px-4">
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-white/45 hover:bg-white/8 hover:text-white/85 max-sm:h-11 max-sm:w-11">
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
