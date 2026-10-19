import { useCallback, useEffect, useState } from "react";
import { Navbar } from "./components/Navbar";
import { applyDelta, callApi } from "./lib/api";
import { AtlasPage } from "./pages/AtlasPage";
import { HomePage, type Act } from "./pages/home/HomePage";
import type { Snapshot } from "./shared/types";

function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname || "/");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname || "/");

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    callApi("getSnapshot").then(setSnapshot, (reason: Error) => setError(reason.message));
  }, []);

  const act = useCallback<Act>(async (name, ...args) => {
    try {
      const delta = await callApi(name, ...args);
      setSnapshot((current) => current && applyDelta(current, delta));
      setError(null);
    } catch (reason) {
      // IPC wraps main-process errors as "Error invoking remote method '...': Error: <message>"
      setError(String((reason as Error).message).replace(/^.*Error: /, ""));
    }
  }, []);

  const navigate = (path: string) => {
    if (path === currentPath) return;

    window.history.pushState({}, "", path);
    setCurrentPath(path);
  };

  const renderPage = () => {
    if (currentPath === "/atlas" || currentPath.startsWith("/atlas/")) {
      return <AtlasPage currentPath={currentPath} onNavigate={navigate} />;
    }

    if (!snapshot) {
      return (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-[28px] border border-white/12 bg-white/6 text-sm tracking-[0.16em] text-white/50 backdrop-blur-xl">
          {error ?? "Loading..."}
        </section>
      );
    }

    return <HomePage snapshot={snapshot} act={act} />;
  };

  return (
    <main className="relative h-screen overflow-hidden bg-transparent text-white">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-2xl" />

      <div className="relative flex h-full min-h-0">
        <Navbar currentPath={currentPath} onNavigate={navigate} />

        <div className="flex min-h-0 flex-1 justify-between gap-6 overflow-hidden p-6">{renderPage()}</div>
      </div>

      {error && snapshot ? (
        <button
          type="button"
          onClick={() => setError(null)}
          className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-red-400/30 bg-black/85 px-4 py-2 text-xs text-red-200"
        >
          {error} ×
        </button>
      ) : null}
    </main>
  );
}

export default App;
