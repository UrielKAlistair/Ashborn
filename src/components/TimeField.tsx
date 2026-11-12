import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { showTime } from "../shared/dates";

/**
 * A time of day, "HH:MM" (24-hour), or "" when `optional` and left empty. It shows as a digital
 * clock on a 12-hour clock. On a touch screen a tap opens three wheels, hour, minute and AM/PM, in
 * place of the system picker (Android's is a dial whose hands are dragged). The hour and minute wheels
 * go round, and carry as a clock does: past :59 the hour steps on, past 11 AM/PM flips. With a mouse
 * and keyboard the time is typed: "7:30 pm", "7.30p", "7pm" and "19:30" all read as 19:30.
 */

// The height of one row of a wheel, in px; a wheel shows five, the chosen one in the middle
const ROW = 40;
const SHOWN = 5;
// A wheel that goes round holds at least this many rows each side of the middle copy of its numbers,
// more than a fling covers, and is moved back to the middle copy when it stops
const REACH = 150;

const pad = (n: number) => String(n).padStart(2, "0");

export function TimeField({ value, onChange, label, optional = false, className = "" }: { value: string; onChange: (value: string) => void; label: string; optional?: boolean; className?: string }) {
  const touch = useRef(window.matchMedia("(pointer: coarse)").matches).current;
  const [open, setOpen] = useState(false);
  // What is typed, read on each change; it follows `value` while the field is not being typed in
  const [draft, setDraft] = useState(shown(value));
  const typing = useRef(false);
  useEffect(() => {
    if (!typing.current) setDraft(shown(value));
  }, [value]);

  const type = (text: string) => {
    setDraft(text);
    if (text.trim() === "") onChange("");
    else {
      const read = readTime(text);
      if (read) onChange(read);
    }
  };

  return (
    <>
      <input
        type="text"
        inputMode={touch ? "none" : "numeric"}
        readOnly={touch}
        aria-label={label}
        title={label}
        placeholder="--:--"
        value={draft}
        onClick={() => touch && setOpen(true)}
        onFocus={() => (typing.current = true)}
        onChange={(event) => type(event.target.value)}
        onBlur={() => {
          typing.current = false;
          setDraft(shown(value));
        }}
        className={`${className} font-['Silkscreen'] tabular-nums ${touch ? "cursor-pointer caret-transparent" : ""}`}
      />
      {open ? <Wheels label={label} value={value} optional={optional} onPick={onChange} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const shown = (value: string) => (value ? showTime(value) : "");

// "HH:MM" from a typed time, 12-hour with AM or PM ("7:30 pm", "7pm", "730p") or 24-hour ("19:30",
// "0730"), or null if it is not one
export function readTime(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i);
  if (!match || (!match[2] && !match[3])) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute >= 60) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[3].toLowerCase() === "p" ? 12 : 0);
  } else if (hour >= 24) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

const HOURS = Array.from({ length: 12 }, (_, n) => String(n || 12)); // 12, 1, 2 … 11
const MINUTES = Array.from({ length: 60 }, (_, n) => pad(n));
const HALVES = ["AM", "PM"];

// The three wheels, over the page; Done keeps the time shown, a tap outside or Back leaves it as it was
function Wheels({ label, value, optional, onPick, onClose }: { label: string; value: string; optional: boolean; onPick: (value: string) => void; onClose: () => void }) {
  const [start] = useState(() => {
    const [h, m] = value ? value.split(":").map(Number) : [new Date().getHours(), new Date().getMinutes()];
    return { hour: h % 12, minute: m, half: h < 12 ? 0 : 1 };
  });
  const chosen = useRef({ ...start });
  const hourWheel = useRef<WheelHandle>(null);
  const halfWheel = useRef<WheelHandle>(null);

  // The phone's Back closes the wheels first
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

  const done = () => {
    const { hour, minute, half } = chosen.current;
    onPick(`${pad(hour + 12 * half)}:${pad(minute)}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-canvas/60 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-xs space-y-4 rounded-2xl border border-ink/10 bg-card p-5 shadow-[var(--card-shadow)]">
        <p className="caps font-display text-[13px] font-bold text-ink/90">{label}</p>
        <div className="relative flex items-center justify-center gap-1">
          {/* The band the chosen row sits in */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 rounded-lg border border-ember/40 bg-ember/8" />
          <Wheel
            ref={hourWheel}
            labels={HOURS}
            start={start.hour}
            round
            label="Hour"
            onChange={(n, laps) => {
              chosen.current.hour = n;
              if (laps) halfWheel.current!.step(laps);
            }}
          />
          <span className="font-['Silkscreen'] text-[28px] text-ember">:</span>
          <Wheel
            labels={MINUTES}
            start={start.minute}
            round
            label="Minute"
            onChange={(n, laps) => {
              chosen.current.minute = n;
              if (laps) hourWheel.current!.step(laps);
            }}
          />
          <Wheel ref={halfWheel} labels={HALVES} start={start.half} label="AM or PM" onChange={(n) => (chosen.current.half = n)} />
        </div>
        <div className="flex justify-end gap-2">
          {optional ? (
            <button
              type="button"
              onClick={() => {
                onPick("");
                onClose();
              }}
              className="rounded-lg px-3 py-1.5 text-[13px] text-muted hover:bg-ink/6 phone:min-h-11"
            >
              No time
            </button>
          ) : null}
          <button type="button" onClick={done} className="rounded-lg bg-ember px-4 py-1.5 text-[13px] font-medium text-canvas hover:brightness-110 phone:min-h-11">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// Moves a wheel on by `rows`, as if scrolled; on a wheel that does not go round it wraps from the
// last row to the first
type WheelHandle = { step: (rows: number) => void };

// One column of labels, scrolled so the chosen one sits in the middle row; it snaps to a row, and a
// tap on a row scrolls it there. A wheel that goes `round` holds its labels many times over, and
// reports with each change how many times it passed from the last label to the first (negative the
// other way), so the next wheel can carry.
const Wheel = forwardRef<WheelHandle, { labels: string[]; start: number; round?: boolean; label: string; onChange: (n: number, laps: number) => void }>(function Wheel(
  { labels, start, round = false, label, onChange },
  handle,
) {
  const period = labels.length;
  const copies = round ? 2 * Math.ceil(REACH / period) + 1 : 1;
  const middle = Math.floor(copies / 2) * period;
  const ref = useRef<HTMLDivElement>(null);
  // The row shown, counted from the top of all the copies; and the row a step is scrolling to
  const row = useRef(middle + start);
  const target = useRef<number | null>(null);
  const [chosen, setChosen] = useState(middle + start);

  useLayoutEffect(() => {
    ref.current!.scrollTop = (middle + start) * ROW;
  }, [middle, start]);

  useImperativeHandle(handle, () => ({
    step: (rows) => {
      const from = target.current ?? row.current;
      target.current = round ? from + rows : (((from + rows) % period) + period) % period;
      ref.current!.scrollTo({ top: target.current * ROW, behavior: "smooth" });
    },
  }));

  const onScroll = () => {
    const now = Math.min(period * copies - 1, Math.max(0, Math.round(ref.current!.scrollTop / ROW)));
    if (now === row.current) return;
    const laps = Math.floor(now / period) - Math.floor(row.current / period);
    row.current = now;
    setChosen(now);
    onChange(now % period, laps);
  };

  // Once still, a wheel that goes round is moved to the same label in the middle copy, uncounted
  const onScrollEnd = () => {
    target.current = null;
    if (!round) return;
    const shift = row.current - (middle + (row.current % period));
    if (shift === 0) return;
    row.current -= shift;
    setChosen(row.current);
    ref.current!.scrollTop = row.current * ROW;
  };

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      onScroll={onScroll}
      onScrollEnd={onScrollEnd}
      className="relative w-[4.5rem] snap-y snap-mandatory overflow-y-scroll [scrollbar-width:none] [mask-image:linear-gradient(transparent,black_35%,black_65%,transparent)]"
      style={{ height: ROW * SHOWN, paddingBlock: ROW * ((SHOWN - 1) / 2) }}
    >
      {Array.from({ length: period * copies }, (_, n) => (
        <div
          key={n}
          role="option"
          aria-selected={n === chosen}
          onClick={() => ref.current!.scrollTo({ top: n * ROW, behavior: "smooth" })}
          className={`flex snap-center items-center justify-center font-['Silkscreen'] tabular-nums ${n === chosen ? "text-[28px] text-ember" : "text-[22px] text-ink/45"}`}
          style={{ height: ROW }}
        >
          {labels[n % period]}
        </div>
      ))}
    </div>
  );
});
