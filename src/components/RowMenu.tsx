import { useState, type FocusEvent } from "react";

// A ⋯ menu of actions; it closes on a choice, on Escape and when focus leaves it
export function RowMenu({ title, items }: { title: string; items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return <span className="w-6 shrink-0" />;
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };

  return (
    <div
      onBlur={leave}
      onKeyDown={(event) => {
        // Escape closes an open menu before the navbar's hide-to-tray handler sees it
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        setOpen(false);
      }}
      className="relative shrink-0"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={`Actions for ${title}`}
        aria-expanded={open}
        className="relative flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-muted before:absolute before:-inset-1.5 before:content-[''] hover:bg-ink/8 hover:text-ink/85 pointer-coarse:h-8 pointer-coarse:w-8"
      >
        ⋯
      </button>
      {open ? (
        <div role="menu" aria-label={`Actions for ${title}`} className="absolute right-0 top-7 z-10 w-40 rounded-lg border border-ink/10 bg-card p-1 shadow-[var(--card-shadow)]">
          {items.map(({ label, onClick }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onClick();
              }}
              className="block w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-ink/85 hover:bg-ink/6 pointer-coarse:min-h-10"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
