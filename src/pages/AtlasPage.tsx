import { CleanRoomPage } from "./atlas/status_ailments/CleanRoomPage";
import { useState } from "react";
import { AtlasSidebarHeader, AtlasSidebarSection } from "./atlas/AtlasSidebar";
import { FpPage } from "./atlas/attributes/FpPage";
import { PhilosophyPage } from "./atlas/PhilosophyPage";
import { HpPage } from "./atlas/attributes/HpPage";
import { PrimaryStatsPage } from "./atlas/attributes/PrimaryStatsPage";
import { ResolutePage } from "./atlas/status_ailments/ResolutePage";

type AtlasPageProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

const philosophyEntry = { label: "Philosophy", path: "/atlas/philosophy" };

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
  const [attributesOpen, setAttributesOpen] = useState(false);
  const [statusAilmentsOpen, setStatusAilmentsOpen] = useState(false);
  const selectedPath =
    currentPath === "/atlas" ? "/atlas/philosophy" : currentPath;

  const renderAtlasEntry = () => {
    if (selectedPath === "/atlas/philosophy") {
      return <PhilosophyPage eyebrow="Philosophy" />;
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
    return <PhilosophyPage eyebrow="Philosophy" />;
  };

  return (
    <section className="-my-6 -ml-6 flex flex-1 self-stretch">
      <aside className="w-full max-w-sm self-stretch border-r border-white/12 bg-white/6 backdrop-blur-xl">
        <div className="sticky top-0 h-screen overflow-y-auto px-5 py-6">
          <AtlasSidebarHeader
            active={selectedPath === philosophyEntry.path}
            entry={philosophyEntry}
            onNavigate={onNavigate}
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

      <div className="flex flex-1 items-start p-6">
        {renderAtlasEntry()}
      </div>
    </section>
  );
}
