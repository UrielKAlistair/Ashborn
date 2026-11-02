// The round done/not-done toggle used for steps, routines and deadlines
export function Tick({ done, onClick, className = "" }: { done: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={done ? "Mark not done" : "Mark done"}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
        done ? "border-transparent bg-emerald-400 text-canvas" : "border-ink/30 text-transparent hover:border-ember hover:text-ember/70"
      } ${className}`}
    >
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 6.2 L5 8.5 L9.5 3.5" />
      </svg>
    </button>
  );
}
