import { CleanRoomPage } from "./atlas/status_ailments/CleanRoom";
import { useState } from "react";
import { AtlasSidebarSection } from "../components/atlas/AtlasSidebar";
import { FpPage } from "./atlas/attributes/FP";
import { HpPage } from "./atlas/attributes/HP";
import { PrimaryStatsPage } from "./atlas/attributes/PrimaryStats";
import { ResolutePage } from "./atlas/status_ailments/Resolute";

type AtlasPageProps = {
  currentPath: string;
  onNavigate: (path: string) => void;
};

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

  const renderAtlasEntry = () => {
    if (currentPath === "/atlas/primary-stats") {
      return <PrimaryStatsPage eyebrow="Attributes" />;
    }
    if (currentPath === "/atlas/hp") return <HpPage eyebrow="Attributes" />;
    if (currentPath === "/atlas/fp") return <FpPage eyebrow="Attributes" />;
    if (currentPath === "/atlas/clean-room") {
      return <CleanRoomPage eyebrow="Status Ailments" />;
    }
    if (currentPath === "/atlas/resolute") {
      return <ResolutePage eyebrow="Status Ailments" />;
    }
  };

  return (
    <section className="flex min-h-0 flex-1 gap-6 overflow-hidden">
      <aside className="flex min-h-0 w-full max-w-sm self-stretch flex-col overflow-hidden rounded-[28px] border border-white/12 bg-white/6 backdrop-blur-xl">
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-5 py-6">

          <AtlasSidebarSection
            entries={attributeEntries}
            isOpen={attributesOpen}
            label="Attributes"
            onNavigate={onNavigate}
            onToggle={() => setAttributesOpen((open) => !open)}
            selectedPath={currentPath}
          />

          <AtlasSidebarSection
            entries={statusAilmentEntries}
            isOpen={statusAilmentsOpen}
            label="Status Ailments"
            onNavigate={onNavigate}
            onToggle={() => setStatusAilmentsOpen((open) => !open)}
            selectedPath={currentPath}
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
