import { useEffect, useState } from "react";
import { setTheme, themeNames, themes, useTheme } from "../lib/useTheme";
import { HexTile } from "./HexTile";
import { MoonIcon, SunIcon } from "./icons";
import { desktopSections, lastScreen, rememberScreen, screenAt, sectionAt, type Section } from "./sections";

type NavbarProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

// The desktop sidebar: one button per section, going straight to the page last open in it. The open
// section's button is labelled with the page shown; pressing it again unfolds the section's pages
// below it, pushing the buttons beneath it down.
export function Navbar({
  currentPath,
  onNavigate,
}: NavbarProps) {
  const [openSection, setOpenSection] = useState<Section | null>(null);
  const currentSection = sectionAt(currentPath);

  useEffect(() => rememberScreen(currentPath), [currentPath]);

  const choose = (section: Section) => {
    if (section !== currentSection || section.desktop.length === 1) {
      setOpenSection(null);
      onNavigate(section === currentSection ? section.desktop[0].path : lastScreen(section, section.desktop));
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

  const theme = useTheme();
  // The switch shows, and goes to, the next theme in turn
  const next = themes[(themes.indexOf(theme) + 1) % themes.length];

  return (
    <aside className="relative z-10 flex h-full min-h-0 w-[5.5rem] shrink-0 flex-col items-center border-r border-ink/8 bg-panel/80 px-2 pt-10 pb-5">
      <div className="flex flex-1 flex-col items-center gap-3">
        {desktopSections.map((section) => {
          const isActive = section === currentSection;
          const Icon = isActive ? (screenAt(currentPath, section.desktop)?.icon ?? section.icon) : section.icon;

          return (
            <div key={section.label} className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => choose(section)}
                aria-expanded={section.desktop.length > 1 ? openSection === section : undefined}
                aria-current={isActive ? "page" : undefined}
                className={`group flex flex-col items-center gap-1.5 bg-transparent ${isActive ? "text-ink" : "text-muted hover:text-ink/80"}`}
              >
                <HexTile active={isActive} className="h-12 w-14">
                  <Icon className={isActive ? "text-ember" : ""} />
                </HexTile>
                <span className={`caps font-display text-[10px] font-semibold ${isActive ? "text-ink/90" : ""}`}>{isActive ? (screenAt(currentPath, section.desktop)?.label ?? section.label) : section.label}</span>
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

      <button
        type="button"
        onClick={() => setTheme(next)}
        title={`${themeNames[next]}: switch to the ${next} theme`}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-ink/8 hover:text-ink/85"
      >
        {next === "light" ? <SunIcon className="h-[18px] w-[18px]" /> : <MoonIcon className="h-[18px] w-[18px]" />}
      </button>
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
                active ? "bg-ember/12 text-ink" : "text-muted hover:bg-ink/6 hover:text-ink/80"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="caps font-display text-[9.5px] font-semibold">{screen.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
