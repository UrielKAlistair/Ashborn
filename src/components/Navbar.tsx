import { invoke } from "@tauri-apps/api/core";
import type { ComponentType } from "react";
import { AtlasIcon, PlaceholderNavIcon, QuitIcon } from "./icons";

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
  { label: "Quest", path: "/", icon: PlaceholderNavIcon },
  { label: "Map", path: "/map", icon: PlaceholderNavIcon },
  { label: "Forge", path: "/forge", icon: PlaceholderNavIcon },
  { label: "Atlas", path: "/atlas", icon: AtlasIcon },
];

export function Navbar({
  currentPath,
  onNavigate,
}: NavbarProps) {
  return (
    <aside className="relative z-10 flex min-h-screen w-24 shrink-0 flex-col items-center border-r border-white/12 bg-white/6 px-3 py-6 backdrop-blur-xl">
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
                className={`flex h-14 w-14 items-center justify-center rounded-xl border bg-black/20 shadow-lg shadow-black/15 transition-colors group-hover:border-white/25 group-hover:bg-white/10 ${
                  isActive ? "border-white/30 bg-white/10" : "border-white/12"
                }`}
              >
                <span className="flex h-10 w-10 rotate-45 items-center justify-center rounded-[10px] border border-white/14 bg-white/6">
                  <Icon className={`-rotate-45 h-5 w-5 ${labelColorClass}`} />
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
          onClick={() => void invoke("exit_app")}
          className="group flex flex-col items-center gap-3 bg-transparent text-white/70"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/12 bg-black/20 shadow-lg shadow-black/15 transition-colors group-hover:border-white/25 group-hover:bg-white/10">
            <span className="flex h-10 w-10 rotate-45 items-center justify-center rounded-[10px] border border-white/14 bg-white/6">
              <QuitIcon className="-rotate-45 h-5 w-5 text-white/45" />
            </span>
          </span>
          <span className="text-[10px] uppercase tracking-[0.24em] text-white/45">
            Quit
          </span>
        </button>
      </div>
    </aside>
  );
}
