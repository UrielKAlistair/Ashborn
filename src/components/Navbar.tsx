import { useEffect, useState } from "react";
import { desktopSections, screenAt, sectionAt, type Section } from "./sections";

type NavbarProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

// The desktop sidebar: one button per section. A section with several pages unfolds them below
// its button, pushing the buttons beneath it down.
export function Navbar({
  currentPath,
  onNavigate,
}: NavbarProps) {
  const [openSection, setOpenSection] = useState<Section | null>(null);
  const currentSection = sectionAt(currentPath);

  const choose = (section: Section) => {
    if (section.desktop.length === 1) {
      setOpenSection(null);
      onNavigate(section.desktop[0].path);
    } else {
      setOpenSection(openSection === section ? null : section);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat) {
        return;
      }

      if (openSection) {
        setOpenSection(null);
        return;
      }

      // In a text field, Escape leaves the field instead of hiding the window
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) {
        event.target.blur();
        return;
      }

      window.ashborn?.hideToTray();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openSection]);

  return (
    <aside className="relative z-10 flex h-full min-h-0 w-24 shrink-0 flex-col items-center border-r border-white/10 bg-night-panel px-3 py-6">
      <div className="flex flex-1 flex-col items-center gap-4">
        {desktopSections.map((section) => {
          const isActive = section === currentSection;
          const labelColorClass = isActive ? "text-white/80" : "text-white/45";
          const Icon = section.icon;

          return (
            <div key={section.label} className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => choose(section)}
                aria-expanded={section.desktop.length > 1 ? openSection === section : undefined}
                className="group flex flex-col items-center gap-3 bg-transparent text-white/70"
              >
                <span
                  className={`flex h-14 w-14 items-center justify-center transition-colors ${
                    isActive ? "text-white/80" : "text-white/45"
                  }`}
                >
                  <span
                    className={`flex h-12 w-12 rotate-45 items-center justify-center rounded-[12px] border transition-colors ${
                      isActive
                        ? "border-white/30 bg-white/10"
                        : "border-white/12 bg-white/6 group-hover:border-white/22 group-hover:bg-white/10"
                    }`}
                  >
                    <Icon className={`-rotate-45 ${labelColorClass}`} />
                  </span>
                </span>
                <span
                  className={`text-[10px] uppercase tracking-[0.24em] ${labelColorClass}`}
                >
                  {section.label}
                </span>
              </button>

              {section.desktop.length > 1 ? (
                <ScreenMenu
                  section={section}
                  open={openSection === section}
                  currentPath={currentPath}
                  onChoose={(path) => {
                    setOpenSection(null);
                    onNavigate(path);
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// A section's pages, unfolding below its button: the grid row grows from nothing to the
// list's height, so the change animates
function ScreenMenu({
  section,
  open,
  currentPath,
  onChoose,
}: {
  section: Section;
  open: boolean;
  currentPath: string;
  onChoose: (path: string) => void;
}) {
  const current = screenAt(currentPath, section.desktop);

  return (
    <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
      <div role="menu" aria-label={section.label} aria-hidden={!open} className="flex flex-col items-center gap-2 overflow-hidden">
        {section.desktop.map((screen, index) => {
          const Icon = screen.icon;
          const active = screen === current;
          return (
            <button
              key={screen.path}
              type="button"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              onClick={() => onChoose(screen.path)}
              className={`flex w-full flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-colors ${index === 0 ? "mt-3" : ""} ${
                active ? "bg-white/10 text-white/85" : "text-white/50 hover:bg-white/6 hover:text-white/80"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[9px] uppercase tracking-[0.18em]">{screen.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
