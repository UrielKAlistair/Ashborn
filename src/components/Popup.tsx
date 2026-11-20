import { useEffect, useRef, type ReactNode } from "react";

/**
 * A pop-up over the page: a titled card with a close button, closed also by Escape or a click
 * outside it. Escape is heard in the capture phase and marked handled, so the navbar's Escape (which
 * hides the desktop window) leaves it alone; with pop-ups stacked, it closes the top one only.
 */
export function Popup({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const open = document.querySelectorAll("[data-popup]");
      if (open[open.length - 1] !== card.current) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/50 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={card} data-popup role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-md space-y-4 rounded-2xl border border-ink/10 bg-card p-5 shadow-[var(--card-shadow)]">
        <div className="flex items-center justify-between">
          <p className="caps font-display text-[13px] font-bold text-ink/90">{label}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-muted hover:bg-ink/8 phone:h-11 phone:w-11">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
