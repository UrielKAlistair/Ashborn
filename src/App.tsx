import { useEffect, useState } from "react";
import { Navbar } from "./components/Navbar";
import { StatPanel } from "./components/StatPanel";
import { AtlasPage } from "./pages/AtlasPage";
import { QuestsPage } from "./pages/QuestsPage";

function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname || "/");
  const stats = [
    { label: "STR", value: 3 },
    { label: "DEX", value: 2 },
    { label: "INT", value: 8 },
    { label: "WIS", value: 5 },
    { label: "CHR", value: 3 },
    { label: "MND", value: 1 },
  ];
  const hp = { current: 112, max: 145 };
  const fp = { current: 75, max: 145 };

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || "/");
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const navigate = (path: string) => {
    if (path === currentPath) {
      return;
    }

    window.history.pushState({}, "", path);
    setCurrentPath(path);
  };

  const renderPage = () => {
    if (currentPath === "/atlas" || currentPath.startsWith("/atlas/")) {
      return <AtlasPage currentPath={currentPath} onNavigate={navigate} />;
    }

    if (currentPath === "/quests") {
      return <QuestsPage />;
    }

    return (
      <>
        <section className="flex flex-1 items-start" />
        <StatPanel fp={fp} hp={hp} stats={stats} />
      </>
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
