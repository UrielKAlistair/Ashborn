import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [navCollapsed, setNavCollapsed] = useState(false);
  const navItems = ["Quest", "Map", "Forge", "Archive"];
  const stats = [
    { label: "STR", value: 3 },
    { label: "DEX", value: 2 },
    { label: "INT", value: 8 },
    { label: "WIS", value: 5 },
    { label: "CHR", value: 3 },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-transparent text-white">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-2xl" />

      <div
        className={`absolute top-6 left-0 z-10 transition-transform duration-300 ease-out ${
          navCollapsed ? "-translate-x-[calc(100%-4rem)]" : "translate-x-0"
        }`}
      >
        <div className="relative inline-flex items-center gap-5 rounded-r-[28px] border border-l-0 border-white/12 bg-white/6 py-5 pr-3 pl-8 shadow-2xl shadow-black/20 backdrop-blur-xl">
          {navItems.map((item) => (
            <button
              key={item}
              type="button"
              className="group flex flex-col items-center gap-3 bg-transparent text-white/70"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/12 bg-black/20 shadow-lg shadow-black/15 transition-colors group-hover:border-white/25 group-hover:bg-white/10">
                <span className="flex h-10 w-10 rotate-45 items-center justify-center rounded-[10px] border border-white/14 bg-white/6">
                  <span className="-rotate-45 text-[10px] uppercase tracking-[0.22em] text-white/45">
                    Slot
                  </span>
                </span>
              </span>
              <span className="text-[10px] uppercase tracking-[0.24em] text-white/45">
                {item}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => void invoke("exit_app")}
            className="group flex flex-col items-center gap-3 bg-transparent text-white/70"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/12 bg-black/20 shadow-lg shadow-black/15 transition-colors group-hover:border-white/25 group-hover:bg-white/10">
              <span className="flex h-10 w-10 rotate-45 items-center justify-center rounded-[10px] border border-white/14 bg-white/6">
                <span className="-rotate-45 text-[10px] uppercase tracking-[0.22em] text-white/45">
                  Quit
                </span>
              </span>
            </span>
            <span className="text-[10px] uppercase tracking-[0.24em] text-white/45">
              Quit
            </span>
          </button>

          <button
            type="button"
            onClick={() => setNavCollapsed((collapsed) => !collapsed)}
            className="flex h-12 w-8 items-center justify-center rounded-full border border-white/12 bg-black/30 text-lg text-white/55 transition-colors hover:border-white/22 hover:text-white/80"
            aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {navCollapsed ? ">" : "<"}
          </button>
        </div>
      </div>

      <div className="relative flex min-h-screen justify-end p-6">
        <aside className="w-full max-w-sm self-start rounded-[28px] border border-white/12 bg-white/6 p-5 backdrop-blur-xl">
          <div className="flex gap-4">
            <div className="flex h-[17.5rem] w-[13rem] shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-black/25 text-center text-xs uppercase tracking-[0.24em] text-white/45">
              Character
              <br />
              Pixel Art
            </div>

            <div className="flex min-w-0 flex-1 flex-col justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">
                  Ashborn
                </h1>
              </div>

              <dl className="mt-1 space-y-1">
                {stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="flex items-center justify-between rounded-xl border border-white/8 bg-black/15 px-3 py-2"
                  >
                    <dt className="text-sm tracking-[0.2em] text-white/60">
                      {stat.label}
                    </dt>
                    <dd className="text-base font-medium text-white">
                      {stat.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default App;
