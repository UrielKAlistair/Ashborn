import { useEffect, useState } from "react";
import { Navbar } from "./components/Navbar";
import { AtlasPage } from "./pages/AtlasPage";
import { HomePage } from "./pages/HomePage";
import { QuestsPage } from "./pages/QuestsPage";
import { getLevelFromXp, getXpProgressPercent } from "./shared/progression";
import type { BoardWidget, GameSnapshot, HomeSnapshot } from "./shared/types";

function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname || "/");
  const [gameSnapshot, setGameSnapshot] = useState<GameSnapshot | null>(null);
  const [homeSnapshot, setHomeSnapshot] = useState<HomeSnapshot | null>(null);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || "/");
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    if (window.ashborn) {
      if (currentPath === "/quests") {
        void window.ashborn.getGameSnapshot().then((nextSnapshot) => {
          if (isMounted) {
            setGameSnapshot(nextSnapshot);
          }
        });
      } else if (!currentPath.startsWith("/atlas/") && currentPath !== "/atlas") {
        void window.ashborn.getHomeSnapshot().then((nextSnapshot) => {
          if (isMounted) {
            setHomeSnapshot(nextSnapshot);
          }
        });
      }
    }

    return () => {
      isMounted = false;
    };
  }, [currentPath]);

  const navigate = (path: string) => {
    if (path === currentPath) {
      return;
    }

    window.history.pushState({}, "", path);
    setCurrentPath(path);
  };

  const toggleTaskInstance = async (instanceId: string) => {
    const nextSnapshot = await window.ashborn?.toggleTaskInstance(instanceId);

    if (nextSnapshot) {
      setGameSnapshot(nextSnapshot);
    }
  };

  const saveDashboardWidgets = async (widgets: BoardWidget[]) => {
    const nextSnapshot = await window.ashborn?.saveDashboardWidgets(widgets);

    if (nextSnapshot) {
      setHomeSnapshot(nextSnapshot);
    }
  };

  const renderPage = () => {
    if (currentPath === "/atlas" || currentPath.startsWith("/atlas/")) {
      return <AtlasPage currentPath={currentPath} onNavigate={navigate} />;
    }

    if (currentPath === "/quests") {
      if (!gameSnapshot) {
        return (
          <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-[28px] border border-white/12 bg-white/6 text-sm tracking-[0.16em] text-white/50 backdrop-blur-xl">
            Loading...
          </section>
        );
      }

      return (
        <QuestsPage
          initialInstances={gameSnapshot.instances}
          initialQuestCategories={gameSnapshot.questCategories}
          initialQuestlines={gameSnapshot.questlines}
          onToggleTaskInstance={toggleTaskInstance}
          tasks={gameSnapshot.tasks}
        />
      );
    }

    if (!homeSnapshot) {
      return (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-[28px] border border-white/12 bg-white/6 text-sm tracking-[0.16em] text-white/50 backdrop-blur-xl">
          Loading...
        </section>
      );
    }

    const hp = homeSnapshot.character.resources.find((resource) => resource.key === "HP");
    const fp = homeSnapshot.character.resources.find((resource) => resource.key === "FP");

    if (!hp || !fp) {
      return (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-[28px] border border-white/12 bg-white/6 px-8 text-center text-sm tracking-[0.16em] text-white/50 backdrop-blur-xl">
          Database is empty. Create character resources, attributes, quest data, and dashboard widgets to begin.
        </section>
      );
    }

    return (
      <HomePage
        allBoardsData={homeSnapshot.boards}
        initialDashConfig={homeSnapshot.dashboardWidgets}
        fp={{ current: fp.current, max: fp.max }}
        hp={{ current: hp.current, max: hp.max }}
        onSaveWidgets={saveDashboardWidgets}
        stats={homeSnapshot.character.attributes.map((attribute) => ({
          key: attribute.key,
          value: getLevelFromXp(attribute.xp),
          xpProgressPercent: getXpProgressPercent(attribute.xp),
        }))}
      />
    );
  };

  return (
    <main className="relative h-screen overflow-hidden bg-transparent text-white">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-2xl" />

      <div className="relative flex h-full min-h-0">
        <Navbar currentPath={currentPath} onNavigate={navigate} />

        <div className="flex min-h-0 flex-1 justify-between gap-6 overflow-hidden p-6">
          {renderPage()}
        </div>
      </div>
    </main>
  );
}

export default App;
