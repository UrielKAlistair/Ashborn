import { useEffect, useState } from "react";
import { addDays, toISODate } from "../shared/dates";
import type { ISODate } from "../shared/types";

/**
 * A calendar date, shown as "Sat 22 Nov" (with the year when not this year). A tap opens a month in
 * the app's own look, in place of the system's date picker; picking a day closes it. The month's
 * arrows step a month at a time, and Today jumps back.
 */

const HEADINGS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function DateField({ value, onChange, label, className = "" }: { value: ISODate; onChange: (value: ISODate) => void; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={label} title={label} onClick={() => setOpen(true)} className={`${className} whitespace-nowrap text-left font-['Silkscreen'] tabular-nums`}>
        {shown(value)}
      </button>
      {open ? (
        <Month
          label={label}
          value={value}
          onPick={(date) => {
            onChange(date);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function Month({ label, value, onPick, onClose }: { label: string; value: ISODate; onPick: (date: ISODate) => void; onClose: () => void }) {
  const today = toISODate(new Date());
  // The first of the month shown
  const [first, setFirst] = useState(() => `${(value || today).slice(0, 7)}-01`);

  // The phone's Back closes the month first
  useEffect(() => {
    const before = window.ashbornBack;
    window.ashbornBack = () => {
      onClose();
      return true;
    };
    return () => {
      window.ashbornBack = before;
    };
  }, [onClose]);

  const [year, month] = first.split("-").map(Number);
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // Blank cells before the 1st, the week starting on Monday
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const step = (months: number) => {
    const at = new Date(Date.UTC(year, month - 1 + months, 1));
    setFirst(toISODate(at).slice(0, 7) + "-01");
  };
  const arrow = "flex h-8 w-8 items-center justify-center rounded-md text-lg text-ink/80 hover:bg-ink/6 phone:h-11 phone:w-11";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/60 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-xs space-y-3 rounded-2xl border border-ink/10 bg-card p-5 shadow-[var(--card-shadow)]">
        <p className="caps font-display text-[13px] font-bold text-ink/90">{label}</p>
        <div className="flex items-center justify-between">
          <button type="button" aria-label="Previous month" onClick={() => step(-1)} className={arrow}>
            ‹
          </button>
          <p className="font-['Silkscreen'] text-[12px] uppercase text-ink/90">
            {new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
          </p>
          <button type="button" aria-label="Next month" onClick={() => step(1)} className={arrow}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {HEADINGS.map((heading) => (
            <span key={heading} className="text-[10.5px] text-muted">
              {heading}
            </span>
          ))}
          {Array.from({ length: lead }, (_, k) => (
            <span key={`lead${k}`} />
          ))}
          {Array.from({ length }, (_, k) => {
            const date = addDays(first, k);
            const chosen = date === value;
            return (
              <button
                key={date}
                type="button"
                aria-label={shown(date)}
                aria-pressed={chosen}
                onClick={() => onPick(date)}
                className={`flex aspect-square items-center justify-center rounded-md font-['Silkscreen'] text-[12px] tabular-nums ${chosen ? "bg-ember text-canvas" : date === today ? "border border-ember/50 text-ember hover:bg-ember/10" : "text-ink/85 hover:bg-ink/6"}`}
              >
                {k + 1}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={() => onPick(today)} className="rounded-lg border border-ink/12 px-3 py-1.5 text-[12.5px] text-ink/80 hover:bg-ink/6 phone:min-h-11">
            Today
          </button>
        </div>
      </div>
    </div>
  );
}

// "Sat 22 Nov", and the year when it isn't this one
function shown(date: ISODate) {
  if (!date) return "Pick a day";
  const [year, month, day] = date.split("-").map(Number);
  const thisYear = year === Number(toISODate(new Date()).slice(0, 4));
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: thisYear ? undefined : "numeric",
    timeZone: "UTC",
  });
}
