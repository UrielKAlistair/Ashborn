// An on/off switch, its touch target taller than it looks
export function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors before:absolute before:-inset-y-2.5 before:inset-x-0 before:content-[''] ${on ? "border-transparent bg-ember" : "border-ink/15 bg-ink/[0.04]"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-[left] ${on ? "left-[22px] bg-canvas" : "left-0.5 bg-ink/70"}`} />
    </button>
  );
}
