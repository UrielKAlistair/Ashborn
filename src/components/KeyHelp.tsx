import { useEffect, useState } from "react";

// The desktop's keys, shown on "?" (never while typing in a field), closed by Escape or a click
const keys: Array<[string, string]> = [
  ["D", "Done: tick the step in Now"],
  ["N", "Not now: pass to the next"],
  ["S", "Split the step in Now"],
  ["/", "Capture a thought"],
  ["Ctrl+Alt+Space", "Capture from anywhere on the desktop"],
  ["Ctrl+Enter", "Add the list in Split"],
  ["Esc", "Close a panel or menu"],
  ["?", "Show these keys"],
];

export function KeyHelp() {
  const [open, setOpen] = useState(false);

  // In the capture phase, so an Escape that closes this is marked handled before the rail's
  // Escape (which hides the window) sees it
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "?") setOpen(!open);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/50" onClick={() => setOpen(false)}>
      <div role="dialog" aria-label="Keys" className="w-80 rounded-2xl border border-ink/10 bg-card p-5 shadow-[var(--card-shadow)]">
        <p className="font-display text-base font-semibold text-ink/90">Keys</p>
        <dl className="mt-3 space-y-2 text-[13px]">
          {keys.map(([key, does]) => (
            <div key={key} className="flex items-baseline gap-3">
              <dt className="w-28 shrink-0">
                <kbd className="rounded-md border border-ink/15 bg-canvas/60 px-1.5 py-0.5 font-mono text-[11.5px] text-ink/85">{key}</kbd>
              </dt>
              <dd className="text-ink/75">{does}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
