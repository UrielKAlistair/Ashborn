import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AtlasIcon, PlaceholderNavIcon, QuitIcon, QuestIcon, HomeIcon } from "./icons";

type NavIconProps = {
  className?: string;
};

type NavItem = {
  label: string;
  path: string;
  icon: ComponentType<NavIconProps>;
};

type NavbarProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

const navItems: NavItem[] = [
  { label: "Home", path: "/", icon: HomeIcon },
  { label: "Quests", path: "/quests", icon: QuestIcon },
  { label: "Forge", path: "/forge", icon: PlaceholderNavIcon },
  { label: "Atlas", path: "/atlas", icon: AtlasIcon },
];

export function Navbar({
  currentPath,
  onNavigate,
}: NavbarProps) {
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  const handleQuit = () => {
    setShowQuitConfirm(false);
    window.ashborn?.quit();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat) {
        return;
      }

      if (showQuitConfirm) {
        setShowQuitConfirm(false);
        return;
      }

      window.ashborn?.hideToTray();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showQuitConfirm]);

  return (
    <aside className="relative z-10 flex h-full min-h-0 w-24 shrink-0 flex-col items-center border-r border-white/12 bg-white/6 px-3 py-6 backdrop-blur-xl">
      <div className="flex flex-1 flex-col items-center gap-4">
        {navItems.map((item) => {
          const isActive =
            currentPath === item.path || currentPath.startsWith(`${item.path}/`);
          const labelColorClass = isActive ? "text-white/80" : "text-white/45";
          const Icon = item.icon;

          return (
            <button
              key={item.path}
              type="button"
              onClick={() => onNavigate(item.path)}
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
                      : "border-white/14 bg-white/6 group-hover:border-white/22 group-hover:bg-white/10"
                  }`}
                >
                  <Icon className={`-rotate-45 ${labelColorClass}`} />
                </span>
              </span>
              <span
                className={`text-[10px] uppercase tracking-[0.24em] ${labelColorClass}`}
              >
                {item.label}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setShowQuitConfirm(true)}
          className="group flex flex-col items-center gap-3 bg-transparent text-white/70"
        >
          <span className="flex h-14 w-14 items-center justify-center text-white/45 transition-colors group-hover:text-white/70">
            <span className="flex h-12 w-12 rotate-45 items-center justify-center rounded-[12px] border border-white/14 bg-white/6 transition-colors group-hover:border-white/22 group-hover:bg-white/10">
              <QuitIcon className="-rotate-45 h-5 w-5 text-white/45" />
            </span>
          </span>
          <span className="text-[10px] uppercase tracking-[0.24em] text-white/45">
            Quit
          </span>
        </button>
      </div>

      {showQuitConfirm
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
              onClick={() => setShowQuitConfirm(false)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="quit-dialog-title"
                className="w-full max-w-[16rem] rounded-2xl border border-white/14 bg-black/80 p-4 text-center shadow-xl shadow-black/25"
                onClick={(event) => event.stopPropagation()}
              >
                <h2
                  id="quit-dialog-title"
                  className="text-sm uppercase tracking-[0.2em] text-white/82"
                >
                  Quit Ashborn?
                </h2>
                <p className="mt-3 text-xs tracking-[0.14em] text-white/48">
                  This will close the application.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQuitConfirm(false)}
                    className="flex-1 rounded-lg border border-white/12 bg-white/6 px-3 py-2 text-xs uppercase tracking-[0.18em] text-white/68 transition-colors hover:border-white/18 hover:bg-white/10 hover:text-white/82"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleQuit}
                    className="flex-1 rounded-lg border border-red-400/30 bg-red-500/18 px-3 py-2 text-xs uppercase tracking-[0.18em] text-red-200 transition-colors hover:border-red-300/45 hover:bg-red-500/28 hover:text-red-100"
                  >
                    Quit
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
