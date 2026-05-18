import { useEffect, useState } from "react";
import { Navbar } from "./components/Navbar";
import { StatPanel } from "./components/StatPanel";
import { AtlasPage } from "./pages/AtlasPage";

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

    return (
      <>
        <section className="flex flex-1 items-start" />
        <StatPanel fp={fp} hp={hp} stats={stats} />
      </>
    );
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-transparent text-white">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-2xl" />

      <div className="relative flex min-h-screen">
        <Navbar currentPath={currentPath} onNavigate={navigate} />

        <div className="flex min-h-screen flex-1 justify-between gap-6 p-6">{renderPage()}</div>
      </div>
    </main>
  );
}

export default App;
