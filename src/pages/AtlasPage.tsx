import { useState } from "react";
import { AtlasSidebarSection } from "../components/atlas/AtlasSidebar";
import { HexMark } from "../components/HexTile";
import { CognitiveOffloadingPage } from "./atlas/Design/CognitiveOffloading";
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
  const [designOpen, setDesignOpen] = useState(true);

  const renderAtlasEntry = () => {
    if (currentPath === "/atlas/cognitive-offloading") {
      return <CognitiveOffloadingPage eyebrow="Design" />;
    }
    if (currentPath === "/atlas/progress") return <ProgressPage eyebrow="Design" />;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-muted">
        <HexMark className="h-10 w-12 text-ink/15" />
        Choose an entry.
      </div>
    );
  };

  return (
    <section className="flex min-h-0 flex-1 gap-6 overflow-hidden">
      <aside className="panel-lift rounded-2xl border border-ink/8 bg-panel flex min-h-0 w-full max-w-72 self-stretch flex-col overflow-hidden">
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto p-4">

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

      <div className="panel-lift rounded-2xl border border-ink/8 bg-panel flex min-h-0 flex-1 self-stretch overflow-hidden">
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto p-6">
          {renderAtlasEntry()}
        </div>
      </div>
    </section>
  );
}
