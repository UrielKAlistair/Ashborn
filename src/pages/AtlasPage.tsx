import { CleanRoomPage } from "./atlas/status_ailments/CleanRoomPage";
import { useState } from "react";
import { AtlasSidebarSection } from "./atlas/AtlasSidebar";
import { FpPage } from "./atlas/attributes/FpPage";
import { HpPage } from "./atlas/attributes/HpPage";
import { PrimaryStatsPage } from "./atlas/attributes/PrimaryStatsPage";
import { ProcrastinationPage } from "./atlas/ProcrastinationPage";
import { PurposePage } from "./atlas/PurposePage";
import { ResolutePage } from "./atlas/status_ailments/ResolutePage";

type AtlasPageProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

const philosophyEntries = [
  { label: "Purpose", path: "/atlas/purpose" },
  { label: "Procrastination", path: "/atlas/procrastination" },
];

const attributeEntries = [
  { label: "Primary Stats", path: "/atlas/primary-stats" },
  { label: "HP", path: "/atlas/hp" },
  { label: "FP", path: "/atlas/fp" },
];

const statusAilmentEntries = [
  { label: "Clean room", path: "/atlas/clean-room" },
  { label: "Resolute", path: "/atlas/resolute" },
];

export function AtlasPage({
  currentPath,
  onNavigate,
}: AtlasPageProps) {
  const [philosophyOpen, setPhilosophyOpen] = useState(true);
  const [attributesOpen, setAttributesOpen] = useState(false);
  const [statusAilmentsOpen, setStatusAilmentsOpen] = useState(false);
  const selectedPath =
    currentPath === "/atlas" ? "/atlas/purpose" : currentPath;

  const renderAtlasEntry = () => {
    if (selectedPath === "/atlas/purpose") {
      return <PurposePage eyebrow="Philosophy" />;
    }
    if (selectedPath === "/atlas/procrastination") {
      return <ProcrastinationPage eyebrow="Philosophy" />;
    }
    if (selectedPath === "/atlas/primary-stats") {
      return <PrimaryStatsPage eyebrow="Attributes" />;
    }
    if (selectedPath === "/atlas/hp") return <HpPage eyebrow="Attributes" />;
    if (selectedPath === "/atlas/fp") return <FpPage eyebrow="Attributes" />;
    if (selectedPath === "/atlas/clean-room") {
      return <CleanRoomPage eyebrow="Status Ailments" />;
    }
    if (selectedPath === "/atlas/resolute") {
      return <ResolutePage eyebrow="Status Ailments" />;
    }
    return <PurposePage eyebrow="Philosophy" />;
  };

  return (
    <section className="flex min-h-0 flex-1 gap-6 overflow-hidden">
      <aside className="flex min-h-0 w-full max-w-sm self-stretch flex-col overflow-hidden rounded-[28px] border border-white/12 bg-white/6 backdrop-blur-xl">
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <AtlasSidebarSection
            entries={philosophyEntries}
            isOpen={philosophyOpen}
            label="Philosophy"
            onNavigate={onNavigate}
            onToggle={() => setPhilosophyOpen((open) => !open)}
            selectedPath={selectedPath}
          />

          <AtlasSidebarSection
            entries={attributeEntries}
            isOpen={attributesOpen}
            label="Attributes"
            onNavigate={onNavigate}
            onToggle={() => setAttributesOpen((open) => !open)}
            selectedPath={selectedPath}
          />

          <AtlasSidebarSection
            entries={statusAilmentEntries}
            isOpen={statusAilmentsOpen}
            label="Status Ailments"
            onNavigate={onNavigate}
            onToggle={() => setStatusAilmentsOpen((open) => !open)}
            selectedPath={selectedPath}
          />
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 self-stretch overflow-hidden rounded-[28px] border border-white/12 bg-white/6 backdrop-blur-xl">
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto p-5 pr-3">
          {renderAtlasEntry()}
        </div>
      </div>
    </section>
  );
}
