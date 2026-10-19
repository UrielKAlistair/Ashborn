import { navItems } from "./Navbar";

// The phone's navigation: the same pages as the desktop sidebar, as a bottom tab bar
export function PhoneTabs({ currentPath, onNavigate }: { currentPath: string; onNavigate: (path: string) => void }) {
  return (
    <nav className="relative z-10 flex shrink-0 justify-around border-t border-white/10 bg-night-panel px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      {navItems.map((item) => {
        const isActive = currentPath === item.path || currentPath.startsWith(`${item.path}/`);
        const Icon = item.icon;
        return (
          <button
            key={item.path}
            type="button"
            onClick={() => onNavigate(item.path)}
            className={`flex flex-col items-center gap-1 px-3 py-1 ${isActive ? "text-white/85" : "text-white/40"}`}
          >
            <span className="flex h-7 items-center">
              <Icon />
            </span>
            <span className="text-[9px] uppercase tracking-[0.2em]">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
