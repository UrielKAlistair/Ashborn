type AtlasSidebarEntry = {
  label: string;
  path: string;
};

type AtlasSidebarItemProps = {
  active: boolean;
  entry: AtlasSidebarEntry;
  onNavigate: (path: string) => void;
};

export function AtlasSidebarItem({
  active,
  entry,
  onNavigate,
}: AtlasSidebarItemProps) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(entry.path)}
      className={`block w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
        active ? "bg-ember/10 text-ember" : "bg-ink/[0.03] text-ink/75 hover:bg-ink/[0.055]"
      }`}
    >
      {entry.label}
    </button>
  );
}

type AtlasSidebarSectionProps = {
  entries: AtlasSidebarEntry[];
  isOpen: boolean;
  label: string;
  onNavigate: (path: string) => void;
  onToggle: () => void;
  selectedPath: string;
};

export function AtlasSidebarSection({
  entries,
  isOpen,
  label,
  onNavigate,
  onToggle,
  selectedPath,
}: AtlasSidebarSectionProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left hover:bg-ink/[0.03]"
      >
        <span className="caps font-display text-[11px] font-semibold text-ink/70">
          {label}
        </span>
        <span className={`inline-block text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
      </button>

      {isOpen ? (
        <div className="mt-2 space-y-1.5">
          {entries.map((entry) => (
            <AtlasSidebarItem
              key={entry.path}
              active={selectedPath === entry.path}
              entry={entry}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
