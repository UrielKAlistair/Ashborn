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
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] ${
        done ? "border-emerald-200/60 bg-emerald-300/80 text-black" : "border-white/30 text-transparent hover:border-white/55"
      } ${className}`}
    >
      ✓
    </button>
  );
}
