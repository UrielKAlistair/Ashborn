import { useState } from "react";
import { fromBase, roundShown, sameName, toBase } from "../../shared/kitchen";
import { stockUnits, type Kitchen, type StockItem, type StockUnit } from "../../shared/types";
import type { Act } from "../home/HomePage";

// A gauge turns amber below this share of its target, and red below the next
const AMBER_BELOW = 0.5;
const RED_BELOW = 0.2;
// Stock above the target shows as a red tip past the gauge's end, and an empty item as a red sliver at
// its start, each this share of the gauge at most
const TIP_MAX = 0.05;

// The kitchen's stores: one bar per tracked staple, and a form to start tracking another
export function StockPanel({ kitchen, act }: { kitchen: Kitchen; act: Act }) {
  const items = [...kitchen.items].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="panel-lift rounded-2xl border border-ink/8 bg-panel panel-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <h2 className="caps font-display text-[13px] font-bold text-ink/85">Stocks</h2>
      {items.length === 0 ? <p className="text-[12px] text-muted">Track a staple below and its bar shows here.</p> : null}
      {items.map((item) => (
        <StockBar key={item.id} item={item} act={act} />
      ))}
      <NewItemForm items={kitchen.items} act={act} />
    </section>
  );
}

// One line with the name, a state tag and the amount against the target, over a notched gauge (a notch
// per tenth of the target) in a framed track. Very low frames it in red; out pulses that frame like a
// game's low-health warning, with a red sliver where the fill would start.
function StockBar({ item, act }: { item: StockItem; act: Act }) {
  const [editing, setEditing] = useState(false);
  const share = item.target > 0 ? item.onHand / item.target : 0;
  const state = share <= 0 ? "Out" : share < RED_BELOW ? "Very low" : share < AMBER_BELOW ? "Low" : null;
  const fill = share >= AMBER_BELOW ? "bg-emerald-400/80" : share >= RED_BELOW ? "bg-amber-400/85" : "bg-red-400/85";
  const tag = state === "Low" ? "text-amber-300 border-amber-300/40" : "text-red-300 border-red-300/40";
  const frame = state === "Out" ? "stock-out border-red-400/70" : state === "Very low" ? "border-red-400/50" : "border-ink/15";
  const tip = Math.min(Math.max(share - 1, 0), TIP_MAX);

  return (
    <div role="group" aria-label={item.name} className="rounded-xl border border-ink/10 bg-card/70 px-3 pt-2 pb-2.5 shadow-[0_1px_0_rgb(110_84_40/0.14)]">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[13px] font-medium text-ink/90 [overflow-wrap:anywhere]">{item.name}</p>
        {state ? <span className={`caps whitespace-nowrap rounded border px-1.5 font-display text-[11px] leading-4 ${tag}`}>{state}</span> : null}
        <p className="font-mono text-[11.5px] tabular-nums text-ink/75">
          {shown(item.onHand, item.unit)}
          <span className="text-muted"> / {shown(item.target, item.unit)}</span>
        </p>
        <button type="button" onClick={() => setEditing(!editing)} className="shrink-0 rounded-md px-1.5 text-[11.5px] text-muted hover:bg-ink/6 hover:text-ink/85 phone:min-h-11 phone:px-2">
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {/* The track leaves room at its end for the overflow tip */}
      <div className="relative mt-1.5 h-2.5" style={{ width: `${100 / (1 + TIP_MAX)}%` }} role="meter" aria-label={`${item.name} stock`} aria-valuenow={item.onHand} aria-valuemin={0} aria-valuemax={item.target}>
        <div className={`absolute inset-0 overflow-hidden rounded-[3px] border bg-ink/[0.06] shadow-[inset_0_1px_1px_rgb(0_0_0/0.12)] ${frame}`}>
          <div className={`h-full ${fill}`} style={{ width: `${(state === "Out" ? TIP_MAX : Math.min(share, 1)) * 100}%` }} />
          <div className="absolute inset-0 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(10%-1px),rgb(0_0_0/0.16)_calc(10%-1px),rgb(0_0_0/0.16)_10%)]" />
        </div>
        {tip > 0 ? <div className="absolute top-0 left-full h-full rounded-r-[3px] bg-red-400/85" style={{ width: `${tip * 100}%` }} title="More than you usually keep" /> : null}
      </div>
      {editing ? (
        <div className="mt-2">
          <StockEditor item={item} act={act} />
        </div>
      ) : null}
    </div>
  );
}

// A slider and a number field, linked, for restocking or correcting by hand; the amount is saved
// as a reading when the user lets go. Until the user moves or types, they follow the stock as it
// changes (a meal cooked meanwhile), and leaving them unchanged saves nothing.
function StockEditor({ item, act }: { item: StockItem; act: Act }) {
  const [edited, setEdited] = useState<number | null>(null);
  const draft = edited ?? fromBase(item.onHand, item.unit);
  // The number field as typed while it is edited, so a cleared field is not read as 0
  const [typed, setTyped] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const max = Math.max(fromBase(item.target, item.unit) * 1.5, draft);
  const step = item.unit === "kg" || item.unit === "l" ? 0.05 : 1;

  const save = () => {
    if (edited === null) return;
    // No stock is below none
    const amount = toBase(Math.max(0, edited), item.unit);
    if (Number.isFinite(amount) && Math.abs(amount - item.onHand) > 1e-9) void act("setStock", crypto.randomUUID(), item.id, amount);
    setEdited(null);
  };

  return (
    <div className="space-y-2 rounded-xl bg-ink/[0.03] p-2.5">
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
            setEdited(Number(event.target.value));
          }}
          onPointerUp={save}
          onKeyUp={save}
          className="min-w-0 flex-1 accent-ember"
        />
        <input
          type="number"
          min={0}
          step="any"
          value={typed ?? roundShown(draft)}
          aria-label={`${item.name} amount in ${item.unit}`}
          onChange={(event) => {
            setTyped(event.target.value);
            if (event.target.value.trim() !== "") setEdited(Number(event.target.value));
          }}
          onBlur={() => {
            // A field left empty is no reading: the amount goes back to the stock's
            if (typed === null || typed.trim() !== "") save();
            else setEdited(null);
            setTyped(null);
          }}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          className="w-16 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-0.5 text-right font-mono tabular-nums phone:min-h-10"
        />
        <span className="text-[11.5px] text-muted">{item.unit}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted">
        <label className="flex items-center gap-1.5">
          Keep
          <input
            type="number"
            min={0}
            step="any"
            // Shown afresh when the target changes elsewhere
            key={item.target}
            defaultValue={roundShown(fromBase(item.target, item.unit))}
            aria-label={`${item.name} target in ${item.unit}`}
            onBlur={(event) => {
              // Passing through the field without typing changes nothing (it shows the target rounded)
              if (event.target.value === event.target.defaultValue) return;
              const target = toBase(Number(event.target.value), item.unit);
              if (target > 0 && target !== item.target) void act("updateStockItem", item.id, { target });
              // Nothing to keep is no target: the field shows the target as it stands
              else if (!(target > 0)) event.target.value = event.target.defaultValue;
            }}
            className="w-14 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-0.5 text-right font-mono tabular-nums phone:min-h-10"
          />
          {item.unit}
        </label>
        <button
          type="button"
          onClick={() => (confirmDelete ? void act("deleteStockItem", item.id) : setConfirmDelete(true))}
          className="rounded-lg border border-red-400/25 px-2.5 py-1 text-[12px] text-red-300 hover:bg-red-400/10 phone:min-h-11"
        >
          {confirmDelete ? "Stop tracking?" : "Stop tracking"}
        </button>
      </div>
    </div>
  );
}

function NewItemForm({ items, act }: { items: StockItem[]; act: Act }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<StockUnit>("kg");
  const [target, setTarget] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start rounded-lg px-1 text-[12.5px] font-medium text-ember hover:brightness-110 phone:min-h-11">
        + Track a staple
      </button>
    );
  }

  const taken = items.find((item) => sameName(item.name, name));
  const valid = name.trim() !== "" && Number(target) > 0 && !taken;
  const submit = () => {
    if (!valid) return;
    void act("createStockItem", { id: crypto.randomUUID(), name: name.trim(), unit, target: toBase(Number(target), unit) });
    setName("");
    setTarget("");
    setOpen(false);
  };

  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-xl bg-ink/[0.03] p-2.5 phone:[&>input]:min-h-11 phone:[&>select]:min-h-11"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input autoFocus placeholder="Rice" value={name} onChange={(event) => setName(event.target.value)} aria-label="Staple" className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-2 py-1" />
      <input type="number" min={0} step="any" placeholder="Keep" value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Amount to keep" className="w-16 rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-2 py-1 text-right font-mono tabular-nums" />
      <select value={unit} onChange={(event) => setUnit(event.target.value as StockUnit)} aria-label="Unit" className="rounded-lg border border-ink/10 bg-canvas/60 text-[13px] text-ink/85 placeholder:text-ink/30 focus:border-ember/60 focus:outline-none px-1.5 py-1">
        {stockUnits.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!valid} className="rounded-lg bg-ember px-3 py-1 text-[12px] font-medium text-canvas hover:brightness-110 disabled:opacity-40 phone:min-h-11 phone:px-4">
        Add
      </button>
      {taken ? <p className="w-full text-[11.5px] text-amber-300">{taken.name} is already tracked.</p> : null}
      <button type="button" onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-ink/8 hover:text-ink/85 phone:h-11 phone:w-11">
        ×
      </button>
    </form>
  );
}

// An amount in base units, written in the item's unit: "5 kg", "2 count" as "2"
function shown(amount: number, unit: StockUnit) {
  const value = roundShown(fromBase(amount, unit));
  return unit === "count" ? `${value}` : `${value} ${unit}`;
}

