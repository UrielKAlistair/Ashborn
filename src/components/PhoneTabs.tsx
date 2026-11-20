import { useLayoutEffect, useRef, useState } from "react";
import { HexTile } from "./HexTile";
import { phoneSections, screenAt, sectionAt, type Section } from "./sections";

// The phone's navigation: one tab per section, grouped towards the middle of the bottom edge. On a
// short screen (the phone on its side) each tab's label sits beside a smaller icon, so the bar takes
// less of the height. A section with several screens
// opens a menu of them upward from its tab; a tap elsewhere closes it.
export function PhoneTabs({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  const [openSection, setOpenSection] = useState<Section | null>(null);
  const currentSection = sectionAt(currentPath);

  const choose = (section: Section) => {
    if (section.phone.length === 1) {
      setOpenSection(null);
      onNavigate(section.phone[0].path);
    } else {
      setOpenSection(openSection === section ? null : section);
    }
  };

  return (
    <nav className="relative z-10 flex shrink-0 justify-center gap-1 border-t border-ink/8 bg-panel px-6 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] short:gap-4 short:pt-1 short:pb-[max(0.25rem,env(safe-area-inset-bottom))]">
      {openSection ? <div className="fixed inset-0 z-40" onClick={() => setOpenSection(null)} /> : null}

      {phoneSections.map((section) => {
        const isActive = section === currentSection;
        const Icon = section.icon;
        return (
          <div key={section.label} className="relative flex w-20 justify-center short:w-auto">
            <button
              type="button"
              onClick={() => choose(section)}
              aria-expanded={section.phone.length > 1 ? openSection === section : undefined}
              className={`group flex min-h-11 flex-col items-center gap-0.5 px-3 py-0.5 short:flex-row short:gap-2 ${isActive ? "text-ember" : "text-muted"}`}
            >
              <HexTile active={isActive} className="h-9 w-[42px] short:h-7 short:w-[33px]">
                <Icon />
              </HexTile>
              <span className="caps font-display text-[10px] font-semibold">{section.label}</span>
            </button>

            {openSection === section ? (
              <ScreenMenu
                section={section}
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
    </nav>
  );
}

// Phone glass curves away at the screen's sides, so a menu keeps this far from either edge
const EDGE_GAP_PX = 16;

// The section's screens, stacked upward and centred above its tab, slid inward where centring would
// bring it within EDGE_GAP_PX of a screen edge.
function ScreenMenu({
  section,
  currentPath,
  onChoose,
}: {
  section: Section;
  currentPath: string;
  onChoose: (path: string) => void;
}) {
  const current = screenAt(currentPath, section.phone);
  const menu = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);
  useLayoutEffect(() => {
    const box = menu.current!.getBoundingClientRect();
    setSlide(Math.max(0, EDGE_GAP_PX - box.left) - Math.max(0, box.right - (window.innerWidth - EDGE_GAP_PX)));
  }, []);

  return (
    <div
      ref={menu}
      style={slide ? { marginLeft: slide } : undefined}
      role="menu"
      aria-label={section.label}
      className={`absolute bottom-full z-50 mb-3 flex left-1/2 -translate-x-1/2 flex-col-reverse gap-0.5 rounded-xl border border-ink/10 bg-card p-1 shadow-[var(--card-shadow)]`}
    >
      {section.phone.map((screen) => {
        const Icon = screen.icon;
        const active = screen === current;
        return (
          <button
            key={screen.path}
            type="button"
            role="menuitem"
            onClick={() => onChoose(screen.path)}
            className={`flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 whitespace-nowrap ${
              active ? "bg-ember/10 text-ember" : "text-ink/65 active:bg-ink/6"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[13px]">{screen.label}</span>
          </button>
        );
      })}
    </div>
  );
}
