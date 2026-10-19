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
      className={`block w-full border px-4 py-3 text-left text-sm tracking-[0.18em] transition-colors ${
        active
          ? "border-white/18 bg-white/10 text-white/88"
          : "border-white/8 bg-night/50 text-white/72 hover:border-white/10 hover:bg-white/8"
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
        className="mt-5 flex w-full items-center justify-between border border-white/10 bg-night/50 px-4 py-3 text-left"
      >
        <span className="text-xs uppercase tracking-[0.28em] text-white/55">
          {label}
        </span>
        <span className="text-lg font-semibold leading-none text-white/80">
          {isOpen ? "-" : "+"}
        </span>
      </button>

      {isOpen ? (
        <div className="mt-3 space-y-2 border-l border-white/10 pl-4">
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
