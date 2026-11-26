import { SITUPS_TO_STOP, STEPS_TO_STOP } from "../lib/motion";
import type { AlarmKind } from "../shared/types";

/**
 * One of a few options, as one row of equal buttons in the app's own look, in place of the system's
 * dropdown; the options' names are short, to fit a phone. KindChoice is the one for how an alarm
 * stops, with what stops it spelt out beneath.
 */
export function Choice<T extends string>({ label, options, value, onChange, disabled = false }: { label: string; options: [T, string][]; value: T; onChange: (value: T) => void; disabled?: boolean }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled}
      className={`grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-ink/10 p-1 ${disabled ? "opacity-40" : ""}`}
    >
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={`whitespace-nowrap rounded-md px-1 py-1.5 text-[12px] leading-4 phone:min-h-11 ${value === option ? "bg-ember/15 text-ember" : "text-muted enabled:hover:bg-ink/6"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const kindNames: Record<Exclude<AlarmKind, "none">, string> = { plain: "Plain", walk: "Walk", situps: "Sit-ups" };
const stops: Partial<Record<AlarmKind, string>> = { walk: `Stops after ${STEPS_TO_STOP} steps`, situps: `Stops after ${SITUPS_TO_STOP} sit-ups` };

// How an alarm stops; with `none`, also an option not to ring, under that name
export function KindChoice<K extends AlarmKind>({ label, value, onChange, none, disabled = false }: { label: string; value: K; onChange: (kind: K) => void; none?: string; disabled?: boolean }) {
  const options = [...(none ? [["none", none]] : []), ...Object.entries(kindNames)] as [K, string][];
  return (
    <div className="space-y-1">
      <Choice label={label} options={options} value={value} onChange={onChange} disabled={disabled} />
      {stops[value] ? <p className="text-[11.5px] text-muted">{stops[value]}</p> : null}
    </div>
  );
}
