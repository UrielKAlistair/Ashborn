import { useState } from "react";
import { AtlasSidebarSection } from "../components/atlas/AtlasSidebar";
import { CognitiveOffloadingPage } from "./atlas/Design/CognitveOffloading";
import { ProgressPage } from "./atlas/Design/Progress";

type AtlasPageProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

const designEntries = [
  { label: "Cognitive Offloading", path: "/atlas/cognitive-offloading" },
  { label: "Progress", path: "/atlas/progress" },
];

export function AtlasPage({
  currentPath,
  onNavigate,
}: AtlasPageProps) {
  const [designOpen, setDesignOpen] = useState(false);

  const renderAtlasEntry = () => {
    if (currentPath === "/atlas/cognitive-offloading") {
      return <CognitiveOffloadingPage eyebrow="Design" />;
    }
    if (currentPath === "/atlas/progress") return <ProgressPage eyebrow="Design" />;
  };

  return (
    <section className="flex min-h-0 flex-1 gap-6 overflow-hidden">
      <aside className="flex min-h-0 w-full max-w-sm self-stretch flex-col overflow-hidden rounded-3xl border border-white/10 bg-night-panel">
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6">

          <AtlasSidebarSection
            entries={designEntries}
            isOpen={designOpen}
            label="Design"
            onNavigate={onNavigate}
            onToggle={() => setDesignOpen((open) => !open)}
            selectedPath={currentPath}
          />
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 self-stretch overflow-hidden rounded-3xl border border-white/10 bg-night-panel">
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto p-5 pr-3">
          {renderAtlasEntry()}
        </div>
      </div>
    </section>
  );
}
